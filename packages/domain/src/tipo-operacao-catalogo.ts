/**
 * OPERACOES-01 F4 (decisão 281) — O CATÁLOGO ÚNICO "O QUE CADA TIPO DE MOVIMENTO MOSTRA E ACEITA".
 *
 * ┌─ O QUE ESTE ARQUIVO É ─────────────────────────────────────────────────────────────────────────────┐
 * │ O dono de três respostas que o editor da TOP (o assistente e as abas) e a API (a recusa do formato  │
 * │ 5) perguntam — uma lista só, publicada pelo servidor nas capacidades (`formato5.catalogo`) e lida   │
 * │ pela tela com um leitor ESTRITO (`lerCatalogoTop`), no molde da matriz das regras gerais:          │
 * │                                                                                                     │
 * │ 1. OS TIPOS DE MOVIMENTO do passo 1 do assistente, AGRUPADOS (Vendas, Compras, Movimentação         │
 * │    interna, Módulos, Financeiro), com a família de cada um e se ele já TEM TELA. Só os que têm tela │
 * │    aparecem para escolha; os outros ficam DECLARADOS "sem tela ainda" e a fase que cria a tela liga │
 * │    o `temTela` (e a família, quando ela nascer no registry).                                       │
 * │ 2. O PERFIL DE CADA FAMÍLIA do registry: as abas que o editor do 5 mostra, as exigências da Geral   │
 * │    com o rótulo do tipo ("Exigir cliente", "Exigir fornecedor"…) e as seções que ficam no padrão.   │
 * │ 3. A RECUSA DO FORMATO 5: o valor que o tipo não aceita (422) e a volta ao padrão antes de gravar. │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ NADA AQUI É SEGUNDA LISTA ────────────────────────────────────────────────────────────────────────┐
 * │ Nenhum código de família está escrito neste arquivo (`familia-operacional-ssot-audit`): a família   │
 * │ de cada tipo é PERGUNTADA ao registry pela tabela e pela variante, e registry sem a variante = tipo │
 * │ sem família e sem tela (fail-closed). O perfil é DERIVADO — do grafo de próximas operações           │
 * │ (`familiaTemProximasOperacoes`), da matriz das regras gerais (`regrasGeraisDaFamiliaTop`), da       │
 * │ matriz de execução (`familiaAceitaExecucaoConfiguradaTop`), do documento de estoque (decisão 274) e │
 * │ do mapa de exigências de cada documento (`exigenciasGeraisDaFamiliaTop`). Mudou uma delas, o perfil │
 * │ muda junto; nada aqui é copiado delas.                                                              │
 * │                                                                                                     │
 * │ SÓ SOMEM ABAS CUJO VALOR O SERVIDOR JÁ OBRIGA AO PADRÃO: Próximas operações sem destino possível,    │
 * │ Aprovação de quem só aceita "Sem aprovação", Execução de quem não tem execução configurada — e, no  │
 * │ documento de estoque, Financeiro e Fiscal (decisão 274). Estoque, Financeiro e Fiscal continuam em   │
 * │ todo tipo fora do documento de estoque (declaração da intenção, como hoje).                         │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A RECUSA VALE SÓ NO FORMATO 5 ────────────────────────────────────────────────────────────────────┐
 * │ Os formatos 1 a 4 continuam conferidos valor por valor, como hoje (`recusasDoPerfilTop` devolve `[]`│
 * │ para eles): uma versão gravada antes do catálogo nunca passa a ser recusada por ele. No 5, a seção  │
 * │ que o tipo não usa tem de estar no padrão e a exigência que o documento do tipo não tem, desligada. │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Ninguém importa este arquivo de volta (sem ciclo): ele lê o registry, a configuração, as matrizes e o ponto de
 * extensão do formato 5, e é lido pela API, pelo editor e pelos testes.
 */
import { CODIGOS_TIPO_OPERACAO, resolverTipoOperacao } from "./tipo-operacao.js";
import { familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda } from "./tipo-operacao-configurado.js";
import { ehFamiliaDeDocumentoEstoque, familiaOperacionalDeDocumentoEstoque } from "./estoque-documento.js";
import { MATRIZ_REGRAS_GERAIS_TOP, regrasGeraisDaFamiliaTop } from "./tipo-operacao-regras-gerais.js";
import { familiaAceitaExecucaoConfiguradaTop } from "./tipo-operacao-execucao.js";
import { familiaTemProximasOperacoes } from "./tipo-operacao-destinos.js";
import { exigenciasGeraisDaFamiliaTop } from "./tipo-operacao-restricoes.js";
import {
  formato5Top,
  normalizarConfiguracaoTop,
  secaoNoNeutroTopV5,
  voltarSecoesAoNeutroTopV5,
  type ConfiguracaoTipoOperacao,
  type ConfiguracaoTipoOperacaoV5,
  type SecaoConfiguracaoTopV5,
} from "./tipo-operacao-configuracao.js";
import {
  DEFINICOES_SECOES_V5,
  ROTULOS_SECOES_EXTENSAO_V5,
  SECOES_EXTENSAO_V5,
  definicaoDaSecaoV5,
  nomeDaSecaoV5,
  type DefinicaoSecaoV5,
  type NomeSecaoExtensaoV5,
} from "./tipo-operacao-secoes-v5.js";

// ---------------------------------------------------------------------------------------------------
// 1. OS GRUPOS, AS ABAS E OS RÓTULOS DAS SEÇÕES
// ---------------------------------------------------------------------------------------------------

/** Os grupos do passo 1, na ordem do pedido do Maike. O grupo NÃO é o `modulo` do registry (ração é Módulos). */
export const GRUPOS_TIPO_MOVIMENTO_TOP = ["vendas", "compras", "movimentacao_interna", "modulos", "financeiro"] as const;
export type GrupoTipoMovimentoTop = (typeof GRUPOS_TIPO_MOVIMENTO_TOP)[number];

export const ROTULOS_GRUPO_TIPO_MOVIMENTO_TOP: Readonly<Record<GrupoTipoMovimentoTop, string>> = Object.freeze({
  vendas: "Vendas",
  compras: "Compras",
  movimentacao_interna: "Movimentação interna",
  modulos: "Módulos",
  financeiro: "Financeiro",
});

/** As abas fixas do editor da TOP, na ordem da tela. As de extensão entram depois de Estoque (`perfilDoTipoTop`). */
export const ABAS_FIXAS_EDITOR_TOP = ["identificacao", "geral", "destinos", "estoque", "financeiro", "fiscal", "aprovacao", "execucao"] as const;
export type AbaEditorTop = (typeof ABAS_FIXAS_EDITOR_TOP)[number] | NomeSecaoExtensaoV5;

/** As seções que um tipo pode exigir no PADRÃO (as três de hoje e as de extensão). */
const SECOES_NEUTRAS_FIXAS_TOP = ["estoque", "financeiro", "fiscal"] as const;
export type SecaoNeutraTop = (typeof SECOES_NEUTRAS_FIXAS_TOP)[number] | NomeSecaoExtensaoV5;

/**
 * Os rótulos das seções da configuração (auditoria, histórico, mensagens), as de extensão inclusive — o rótulo de
 * cada uma é o da definição dela. Um dono só: o web lê daqui.
 */
export const ROTULOS_SECAO_CONFIGURACAO_TOP: Readonly<Record<SecaoConfiguracaoTopV5, string>> = Object.freeze({
  geral: "Geral",
  estoque: "Estoque",
  financeiro: "Financeiro",
  fiscal: "Fiscal",
  aprovacao: "Aprovação",
  execucao: "Execução",
  ...ROTULOS_SECOES_EXTENSAO_V5,
});

// ---------------------------------------------------------------------------------------------------
// 2. OS TIPOS DE MOVIMENTO
// ---------------------------------------------------------------------------------------------------

/** Um tipo do passo 1. `familia` `null` = a família ainda não existe no registry (a fase dona a cria). */
export interface TipoDeMovimentoTop {
  /** Identidade do tipo no catálogo (e no `data-testid` do assistente). Nunca é código de família: sem ponto. */
  readonly chave: string;
  readonly grupo: GrupoTipoMovimentoTop;
  readonly rotulo: string;
  readonly familia: string | null;
  /** Aparece para escolha no passo 1? Só com família e com a tela que lança o documento citando a TOP. */
  readonly temTela: boolean;
}

/**
 * Um tipo, congelado. `temTela` só vale com família: o registry que deixar de declarar a variante tira o tipo da
 * escolha em vez de oferecer uma TOP sem família (fail-closed).
 */
const tipo = (chave: string, grupo: GrupoTipoMovimentoTop, rotulo: string, familia: string | null | undefined, temTela: boolean): TipoDeMovimentoTop =>
  Object.freeze({ chave, grupo, rotulo, familia: familia ?? null, temTela: temTela && typeof familia === "string" });

/** As famílias de tabela inteira e de variante perguntadas ao registry — nunca escritas aqui. */
const familiaDaTabela = (tabela: string, valor?: string): string | undefined => resolverTipoOperacao(tabela, valor)?.codigo;

/**
 * OS 22 TIPOS, NA ORDEM DO PEDIDO. Só os 9 cujo documento cita a TOP (venda, compra e o documento de estoque) têm
 * tela hoje. "Requisição" é a espécie NOVA da F5 (família ainda inexistente), não a requisição antiga do estoque; os
 * tipos de Módulos e do Financeiro que já têm família ficam com ela, sem tela: a F10 e a F9 os ligam. Orçamento de
 * compra (F6), consumo e devolução de consumo (F5), manejo e batelada (F10) e movimento bancário (F9) nascem sem
 * família — a fase dona cria a família no registry e troca a linha.
 */
export const CATALOGO_TIPOS_MOVIMENTO_TOP: readonly TipoDeMovimentoTop[] = Object.freeze([
  tipo("orcamento_venda", "vendas", "Orçamento", familiaOperacionalDeDocumentoVenda("budget"), true),
  tipo("pedido_venda", "vendas", "Pedido", familiaOperacionalDeDocumentoVenda("order"), true),
  tipo("venda", "vendas", "Venda", familiaOperacionalDeDocumentoVenda("sale"), true),
  tipo("pedido_compra", "compras", "Pedido", familiaOperacionalDeDocumentoCompra("pedido"), true),
  tipo("orcamento_compra", "compras", "Orçamento", null, false),
  tipo("compra", "compras", "Compra", familiaOperacionalDeDocumentoCompra("compra"), true),
  tipo("requisicao", "movimentacao_interna", "Requisição", null, false),
  tipo("consumo", "movimentacao_interna", "Consumo", null, false),
  tipo("devolucao_consumo", "movimentacao_interna", "Devolução de consumo", null, false),
  tipo("entrada", "movimentacao_interna", "Entrada", familiaOperacionalDeDocumentoEstoque("entrada"), true),
  tipo("saida", "movimentacao_interna", "Saída/baixa", familiaOperacionalDeDocumentoEstoque("saida"), true),
  tipo("transferencia", "movimentacao_interna", "Transferência", familiaOperacionalDeDocumentoEstoque("transferencia"), true),
  tipo("ajuste", "movimentacao_interna", "Ajuste", familiaOperacionalDeDocumentoEstoque("ajuste"), true),
  tipo("abastecimento", "modulos", "Abastecimento", familiaDaTabela("erp.fuel_supplies"), false),
  tipo("manutencao", "modulos", "Manutenção", familiaDaTabela("erp.maintenances"), false),
  tipo("ordem_servico", "modulos", "Ordem de serviço", familiaDaTabela("erp.service_orders"), false),
  tipo("manejo", "modulos", "Manejo", null, false),
  tipo("batelada", "modulos", "Batelada", null, false),
  tipo("producao_racao", "modulos", "Produção de ração", familiaDaTabela("erp.feed_batches"), false),
  tipo("conta_pagar", "financeiro", "Conta a pagar", familiaDaTabela("erp.financial_titles", "payable"), false),
  tipo("conta_receber", "financeiro", "Conta a receber", familiaDaTabela("erp.financial_titles", "receivable"), false),
  tipo("movimento_bancario", "financeiro", "Movimento bancário", null, false),
]);

// ---------------------------------------------------------------------------------------------------
// 3. O PERFIL DE CADA FAMÍLIA — derivado
// ---------------------------------------------------------------------------------------------------

/** As quatro exigências da Geral, na ordem fixa (a das recusas e da volta ao padrão). */
export const CHAVES_EXIGENCIA_TOP = ["exigeParceiro", "exigeCentroResultado", "exigeObservacao", "exigeTransportadora"] as const;
export type ChaveExigenciaTop = (typeof CHAVES_EXIGENCIA_TOP)[number];

/** Uma exigência que o documento do tipo TEM, com o rótulo do campo no documento ("Cliente", "Fornecedor"…). */
export interface ExigenciaDoPerfilTop {
  readonly chave: ChaveExigenciaTop;
  readonly rotulo: string;
}

/**
 * As exigências de quem NÃO tem documento que cite a TOP (as famílias das telas antigas, os módulos, o financeiro):
 * as quatro de hoje, com o rótulo GENÉRICO — "Cliente" numa conta a pagar seria falso.
 */
export const EXIGENCIAS_GERAIS_SEM_DOCUMENTO_TOP: readonly ExigenciaDoPerfilTop[] = Object.freeze([
  Object.freeze({ chave: "exigeParceiro", rotulo: "Parceiro" }),
  Object.freeze({ chave: "exigeCentroResultado", rotulo: "Centro de resultado" }),
  Object.freeze({ chave: "exigeObservacao", rotulo: "Observação" }),
  Object.freeze({ chave: "exigeTransportadora", rotulo: "Transportadora" }),
]);

/** O que a família mostra e aceita no editor do formato 5. */
export interface PerfilDoTipoTop {
  readonly familia: string;
  /** As abas, na ordem da tela. */
  readonly abas: readonly AbaEditorTop[];
  /** As exigências da Geral que o documento da família tem, na ordem fixa, com o rótulo do tipo. */
  readonly exigencias: readonly ExigenciaDoPerfilTop[];
  /** As seções que a família não usa e que, no formato 5, têm de ficar no padrão. */
  readonly secoesNeutras: readonly SecaoNeutraTop[];
}

/**
 * O PERFIL DA FAMÍLIA, derivado (a ordem das abas é esta):
 *   1. `identificacao`, `geral` — sempre;
 *   2. `destinos` — só se a família tem próximas operações possíveis (`familiaTemProximasOperacoes`);
 *   3. `estoque` — sempre (no documento de estoque é a aba com o aviso "definido pela espécie");
 *   4. as seções de extensão que a família usa (`usadaPor`), na ordem de `DEFINICOES_SECOES_V5`;
 *   5. `financeiro`, `fiscal` — só fora do documento de estoque (decisão 274);
 *   6. `aprovacao` — só se a matriz das regras gerais aceita, para a família, algo além de "Sem aprovação";
 *   7. `execucao` — só se a família tem execução configurada (`familiaAceitaExecucaoConfiguradaTop`).
 * Exigências: família COM documento (uma linha da matriz das regras gerais) → o mapa do documento dela; SEM
 * documento → as quatro genéricas. Seções neutras: no documento de estoque, Estoque, Financeiro e Fiscal; e toda
 * seção de extensão que a família não usa. `definicoes` é parâmetro só para teste.
 */
export function perfilDoTipoTop(familia: string, definicoes: readonly DefinicaoSecaoV5[] = DEFINICOES_SECOES_V5): PerfilDoTipoTop {
  const documentoEstoque = ehFamiliaDeDocumentoEstoque(familia);
  const usadas = definicoes.filter((d) => d.usadaPor(familia)).map(nomeDaSecaoV5);
  const naoUsadas = definicoes.filter((d) => !d.usadaPor(familia)).map(nomeDaSecaoV5);
  const abas: AbaEditorTop[] = [
    "identificacao",
    "geral",
    ...(familiaTemProximasOperacoes(familia) ? ["destinos" as const] : []),
    "estoque",
    ...usadas,
    ...(documentoEstoque ? [] : ["financeiro" as const, "fiscal" as const]),
    ...(regrasGeraisDaFamiliaTop(familia).aprovacao.aceitos.some((p) => p !== "nenhuma") ? ["aprovacao" as const] : []),
    ...(familiaAceitaExecucaoConfiguradaTop(familia) ? ["execucao" as const] : []),
  ];
  const comDocumento = MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === familia);
  const exigencias = comDocumento
    ? exigenciasGeraisDaFamiliaTop(familia).map((e) => Object.freeze({ chave: e.chave, rotulo: e.rotulo }))
    : EXIGENCIAS_GERAIS_SEM_DOCUMENTO_TOP;
  const secoesNeutras: SecaoNeutraTop[] = [...(documentoEstoque ? SECOES_NEUTRAS_FIXAS_TOP : []), ...naoUsadas];
  return Object.freeze({
    familia,
    abas: Object.freeze(abas),
    exigencias: Object.freeze([...exigencias]),
    secoesNeutras: Object.freeze(secoesNeutras),
  });
}

/** Um perfil por família do registry, na ordem do registry. */
export const PERFIS_TIPO_TOP: readonly PerfilDoTipoTop[] = Object.freeze(CODIGOS_TIPO_OPERACAO.map((f) => perfilDoTipoTop(f)));

// ---------------------------------------------------------------------------------------------------
// 4. O CATÁLOGO — publicado, lido e consultado
// ---------------------------------------------------------------------------------------------------

export interface GrupoDoCatalogoTop {
  readonly chave: GrupoTipoMovimentoTop;
  readonly rotulo: string;
}

/** O catálogo como o servidor publica (`capabilities.formato5.catalogo`) e a tela lê. */
export interface CatalogoTop {
  readonly grupos: readonly GrupoDoCatalogoTop[];
  readonly tipos: readonly TipoDeMovimentoTop[];
  readonly perfis: readonly PerfilDoTipoTop[];
}

export const CATALOGO_TOP: CatalogoTop = Object.freeze({
  grupos: Object.freeze(GRUPOS_TIPO_MOVIMENTO_TOP.map((chave) => Object.freeze({ chave, rotulo: ROTULOS_GRUPO_TIPO_MOVIMENTO_TOP[chave] }))),
  tipos: CATALOGO_TIPOS_MOVIMENTO_TOP,
  perfis: PERFIS_TIPO_TOP,
});

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** O objeto tem EXATAMENTE estas chaves, todas próprias — nem a mais, nem a menos. */
const temExatamente = (o: Record<string, unknown>, chaves: readonly string[]): boolean =>
  Object.keys(o).length === chaves.length && chaves.every((k) => Object.hasOwn(o, k));

const textoComConteudo = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** A forma da chave do tipo: minúscula, dígito e sublinhado — nunca ponto (não é código de família). */
const FORMA_CHAVE_TIPO = /^[a-z][a-z0-9_]*$/;

const CHAVES_CATALOGO = ["grupos", "tipos", "perfis"] as const;
const CHAVES_GRUPO = ["chave", "rotulo"] as const;
const CHAVES_TIPO = ["chave", "grupo", "rotulo", "familia", "temTela"] as const;
const CHAVES_PERFIL = ["familia", "abas", "exigencias", "secoesNeutras"] as const;
const CHAVES_EXIGENCIA = ["chave", "rotulo"] as const;

/** As abas e as seções neutras que ESTA tela conhece: as fixas e as de extensão do produto. */
const ABAS_CONHECIDAS: readonly AbaEditorTop[] = [...ABAS_FIXAS_EDITOR_TOP, ...SECOES_EXTENSAO_V5];
const SECOES_NEUTRAS_CONHECIDAS: readonly SecaoNeutraTop[] = [...SECOES_NEUTRAS_FIXAS_TOP, ...SECOES_EXTENSAO_V5];

/** O valor é um texto deste domínio fechado? */
const doDominio = <T extends string>(v: unknown, dominio: readonly T[]): v is T =>
  typeof v === "string" && (dominio as readonly string[]).includes(v);

/** Uma lista de textos do domínio, sem repetição; qualquer desvio → `null`. */
function lerListaDoDominio<T extends string>(bruto: unknown, dominio: readonly T[]): T[] | null {
  if (!Array.isArray(bruto)) return null;
  const lista: T[] = [];
  for (const v of bruto) {
    if (!doDominio(v, dominio) || lista.includes(v)) return null;
    lista.push(v);
  }
  return lista;
}

function lerGrupos(bruto: unknown): GrupoDoCatalogoTop[] | null {
  if (!Array.isArray(bruto)) return null;
  const grupos: GrupoDoCatalogoTop[] = [];
  for (const g of bruto) {
    if (!ehObjeto(g) || !temExatamente(g, CHAVES_GRUPO)) return null;
    const { chave, rotulo } = g;
    if (!doDominio(chave, GRUPOS_TIPO_MOVIMENTO_TOP) || grupos.some((x) => x.chave === chave) || !textoComConteudo(rotulo)) return null;
    grupos.push({ chave, rotulo });
  }
  return grupos;
}

function lerExigencias(bruto: unknown): ExigenciaDoPerfilTop[] | null {
  if (!Array.isArray(bruto)) return null;
  const exigencias: ExigenciaDoPerfilTop[] = [];
  for (const e of bruto) {
    if (!ehObjeto(e) || !temExatamente(e, CHAVES_EXIGENCIA)) return null;
    const { chave, rotulo } = e;
    if (!doDominio(chave, CHAVES_EXIGENCIA_TOP) || exigencias.some((x) => x.chave === chave) || !textoComConteudo(rotulo)) return null;
    exigencias.push({ chave, rotulo });
  }
  return exigencias;
}

function lerPerfis(bruto: unknown): PerfilDoTipoTop[] | null {
  if (!Array.isArray(bruto)) return null;
  const perfis: PerfilDoTipoTop[] = [];
  for (const p of bruto) {
    if (!ehObjeto(p) || !temExatamente(p, CHAVES_PERFIL)) return null;
    const { familia } = p;
    if (!textoComConteudo(familia) || perfis.some((x) => x.familia === familia)) return null;
    const abas = lerListaDoDominio(p.abas, ABAS_CONHECIDAS);
    const exigencias = lerExigencias(p.exigencias);
    const secoesNeutras = lerListaDoDominio(p.secoesNeutras, SECOES_NEUTRAS_CONHECIDAS);
    if (!abas || !exigencias || !secoesNeutras) return null;
    perfis.push({ familia, abas, exigencias, secoesNeutras });
  }
  return perfis;
}

function lerTipos(bruto: unknown, grupos: readonly GrupoDoCatalogoTop[], perfis: readonly PerfilDoTipoTop[]): TipoDeMovimentoTop[] | null {
  if (!Array.isArray(bruto)) return null;
  const tipos: TipoDeMovimentoTop[] = [];
  for (const t of bruto) {
    if (!ehObjeto(t) || !temExatamente(t, CHAVES_TIPO)) return null;
    const { chave, rotulo, familia, temTela } = t;
    if (typeof chave !== "string" || !FORMA_CHAVE_TIPO.test(chave) || tipos.some((x) => x.chave === chave)) return null;
    const grupo = grupos.find((g) => g.chave === t.grupo)?.chave;
    if (grupo === undefined || !textoComConteudo(rotulo)) return null;
    if (familia !== null && (!textoComConteudo(familia) || tipos.some((x) => x.familia === familia))) return null;
    if (typeof temTela !== "boolean") return null;
    // Tipo oferecido para escolha sem família, ou sem o perfil que diz as abas dele, não tem tela honesta.
    if (temTela && (familia === null || !perfis.some((p) => p.familia === familia))) return null;
    tipos.push({ chave, grupo, rotulo, familia, temTela });
  }
  return tipos;
}

/**
 * Lê ESTRITAMENTE o catálogo que o servidor publicou. Qualquer desvio devolve `null`, e a tela trata o bloco do
 * formato 5 como inexistente (o editor do 4 de hoje) — em vez de adivinhar um pedaço do catálogo:
 *   · raiz sem EXATAMENTE `grupos`, `tipos` e `perfis`;
 *   · grupo sem exatamente `{chave, rotulo}`, chave fora de `GRUPOS_TIPO_MOVIMENTO_TOP` ou repetida, rótulo vazio;
 *   · tipo sem exatamente `{chave, grupo, rotulo, familia, temTela}`; chave vazia, com ponto (fora de
 *     `^[a-z][a-z0-9_]*$`) ou repetida; grupo não declarado; rótulo vazio; família que não é texto com conteúdo
 *     nem `null`, ou repetida entre tipos; `temTela` não booleano; `temTela` verdadeiro com família `null` ou sem
 *     perfil;
 *   · perfil sem exatamente `{familia, abas, exigencias, secoesNeutras}`; família vazia ou repetida; aba fora das
 *     fixas e das de extensão desta tela, ou repetida; exigência sem exatamente `{chave, rotulo}`, chave fora das
 *     quatro ou repetida, rótulo vazio; seção neutra fora de Estoque/Financeiro/Fiscal e das de extensão, ou repetida.
 * Devolve objetos novos: nada do resultado aponta para o que veio da rede. Molde: `lerMatrizRegrasGeraisTop`.
 */
export function lerCatalogoTop(bruto: unknown): CatalogoTop | null {
  if (!ehObjeto(bruto) || !temExatamente(bruto, CHAVES_CATALOGO)) return null;
  const grupos = lerGrupos(bruto.grupos);
  const perfis = lerPerfis(bruto.perfis);
  if (!grupos || !perfis) return null;
  const tipos = lerTipos(bruto.tipos, grupos, perfis);
  if (!tipos) return null;
  return { grupos, tipos, perfis };
}

/** Um grupo do passo 1 com os tipos que ele oferece. */
export interface GrupoParaEscolhaTop {
  grupo: GrupoDoCatalogoTop;
  tipos: TipoDeMovimentoTop[];
}

/** O passo 1: só os tipos com tela, agrupados na ordem do catálogo; grupo sem tipo com tela some. */
export function tiposParaEscolhaTop(c: CatalogoTop): GrupoParaEscolhaTop[] {
  return c.grupos
    .map((grupo) => ({ grupo, tipos: c.tipos.filter((t) => t.temTela && t.grupo === grupo.chave) }))
    .filter((g) => g.tipos.length > 0);
}

/** O perfil desta família no catálogo, ou `null` (família sem perfil — quem chama NEGA, nunca usa um vizinho). */
export function perfilDaFamiliaTop(familia: string, c: CatalogoTop = CATALOGO_TOP): PerfilDoTipoTop | null {
  return c.perfis.find((p) => p.familia === familia) ?? null;
}

// ---------------------------------------------------------------------------------------------------
// 5. A RECUSA DO FORMATO 5 E A VOLTA AO PADRÃO
// ---------------------------------------------------------------------------------------------------

/** 422 — a exigência marcada é de um campo que o documento do tipo não tem. */
export const MENSAGEM_EXIGENCIA_FORA_DO_TIPO = "O documento desta operação não tem este campo.";
/** 422 — condição de pagamento permitida numa operação sem a seção Financeiro. */
export const MENSAGEM_CONDICOES_FORA_DO_TIPO = "Esta operação não usa condições de pagamento.";
/** 422 — seção fora do padrão numa operação que não a usa. */
export const mensagemSecaoForaDoTipo = (rotulo: string): string => `Esta operação não usa a seção ${rotulo}.`;

/** Uma recusa do perfil, no formato das outras recusas da configuração (`{motivo, caminho, mensagem}`). */
export interface RecusaPerfilTop {
  motivo: "combinacao_nao_suportada";
  caminho: string;
  mensagem: string;
}

/**
 * O que o tipo não aceita nesta configuração — a recusa 422 da gravação do formato 5. `[]` fora do formato 5 (1 a 4:
 * o comportamento de hoje, conferido valor por valor) e para família sem perfil no catálogo. Ordem fixa: as
 * exigências (parceiro, centro, observação, transportadora) e depois as seções, na ordem de `secoesNeutras`:
 *   · exigência fora das do perfil e marcada → `geral.<chave>`, `MENSAGEM_EXIGENCIA_FORA_DO_TIPO`;
 *   · seção neutra do perfil fora do neutro do 5 (comparada depois de normalizar) → `<secao>`,
 *     `mensagemSecaoForaDoTipo(<rótulo da seção>)`.
 */
export function recusasDoPerfilTop(codigoBase: string, c: ConfiguracaoTipoOperacao, catalogo: CatalogoTop = CATALOGO_TOP): RecusaPerfilTop[] {
  if (!formato5Top(c)) return [];
  const perfil = perfilDaFamiliaTop(codigoBase, catalogo);
  if (!perfil) return [];
  const recusas: RecusaPerfilTop[] = [];
  for (const chave of CHAVES_EXIGENCIA_TOP) {
    if (c.geral[chave] && !perfil.exigencias.some((e) => e.chave === chave)) {
      recusas.push({ motivo: "combinacao_nao_suportada", caminho: `geral.${chave}`, mensagem: MENSAGEM_EXIGENCIA_FORA_DO_TIPO });
    }
  }
  for (const secao of perfil.secoesNeutras) {
    if (!secaoNoNeutroTopV5(c, secao)) {
      recusas.push({ motivo: "combinacao_nao_suportada", caminho: secao, mensagem: mensagemSecaoForaDoTipo(ROTULOS_SECAO_CONFIGURACAO_TOP[secao]) });
    }
  }
  return recusas;
}

/**
 * O tipo aceita CONDIÇÕES DE PAGAMENTO permitidas? Só o que tem a aba Financeiro (fora do documento de estoque). A
 * pergunta única da recusa (`recusaDasCondicoesDoPerfilTop`) e da volta ao padrão (`condicoesQueVoltamPeloPerfilTop`).
 */
const perfilAceitaCondicoesTop = (perfil: PerfilDoTipoTop): boolean => perfil.abas.includes("financeiro");

/**
 * A recusa das CONDIÇÕES DE PAGAMENTO permitidas pelo perfil: só no formato 5, só com alguma condição, e só quando o
 * tipo não tem a aba Financeiro (o documento de estoque). `null` em todo o resto — os formatos 1 a 4 seguem a régua
 * de hoje. `quantidade` é a da lista que a versão nova vai carregar: a ENVIADA, ou a PRESERVADA da vigente quando o
 * corpo traz a configuração no 5 sem a lista (a API pergunta as duas) — uma TOP de documento de estoque gravada no 4
 * com condições não vira um 5 com condições num tipo sem Financeiro.
 */
export function recusaDasCondicoesDoPerfilTop(
  codigoBase: string,
  c: ConfiguracaoTipoOperacao,
  quantidade: number,
  catalogo: CatalogoTop = CATALOGO_TOP,
): { caminho: "condicoesPermitidas"; mensagem: string } | null {
  if (!formato5Top(c) || quantidade <= 0) return null;
  const perfil = perfilDaFamiliaTop(codigoBase, catalogo);
  if (!perfil || perfilAceitaCondicoesTop(perfil)) return null;
  return { caminho: "condicoesPermitidas", mensagem: MENSAGEM_CONDICOES_FORA_DO_TIPO };
}

/** Uma opção que volta ao padrão antes de gravar: onde, e o texto do diálogo "Estas regras passam a valer". */
export interface SecaoQueVoltaTop {
  readonly caminho: string;
  readonly texto: string;
}

/** O rótulo de cada exigência no editor e no diálogo da volta ao padrão. */
export const ROTULO_EXIGENCIA_TOP: Readonly<Record<ChaveExigenciaTop, string>> = Object.freeze({
  exigeParceiro: "Exigir parceiro",
  exigeCentroResultado: "Exigir centro de resultado",
  exigeObservacao: "Exigir observação",
  exigeTransportadora: "Exigir transportadora",
});

/** O rótulo da seção: o da definição (seção de extensão, inclusive a de teste) ou o da lista fixa. */
const rotuloDaSecao = (secao: SecaoNeutraTop, definicoes: readonly DefinicaoSecaoV5[]): string =>
  definicaoDaSecaoV5(secao, definicoes)?.rotulo ?? ROTULOS_SECAO_CONFIGURACAO_TOP[secao];

/**
 * O que o editor do 5 faz ANTES de gravar: volta ao padrão o que o tipo não aceita (o servidor recusaria o resto), e
 * diz o quê — a lista `voltaram` vai para o diálogo "Estas regras passam a valer", na ordem de `recusasDoPerfilTop`:
 *   · exigência fora do perfil e marcada → desmarcada; texto `"<Exigir …>: Sim → Não"`;
 *   · seção neutra fora do neutro → o neutro do 5; texto `"<Seção>: volta ao padrão"`.
 * Não muta a entrada e não devolve referência a ela (a configuração sai normalizada, cada seção copiada).
 * `definicoes` é parâmetro só para teste.
 */
export function normalizarPeloPerfilTop(
  perfil: PerfilDoTipoTop,
  c: ConfiguracaoTipoOperacaoV5,
  definicoes: readonly DefinicaoSecaoV5[] = DEFINICOES_SECOES_V5,
): { configuracao: ConfiguracaoTipoOperacaoV5; voltaram: SecaoQueVoltaTop[] } {
  const base = normalizarConfiguracaoTop(c, definicoes);
  const geral = { ...base.geral };
  const voltaram: SecaoQueVoltaTop[] = [];
  for (const chave of CHAVES_EXIGENCIA_TOP) {
    if (geral[chave] && !perfil.exigencias.some((e) => e.chave === chave)) {
      geral[chave] = false;
      voltaram.push({ caminho: `geral.${chave}`, texto: `${ROTULO_EXIGENCIA_TOP[chave]}: Sim → Não` });
    }
  }
  const comExigencias: ConfiguracaoTipoOperacaoV5 = { ...base, geral };
  const foraDoNeutro = perfil.secoesNeutras.filter((secao) => !secaoNoNeutroTopV5(comExigencias, secao, definicoes));
  for (const secao of foraDoNeutro) voltaram.push({ caminho: secao, texto: `${rotuloDaSecao(secao, definicoes)}: volta ao padrão` });
  return { configuracao: voltarSecoesAoNeutroTopV5(comExigencias, foraDoNeutro, definicoes), voltaram };
}

/** O texto do diálogo "Estas regras passam a valer" quando as condições de pagamento permitidas voltam ao padrão. */
export const TEXTO_CONDICOES_VOLTAM_TOP = "Condições de pagamento: voltam ao padrão";

/**
 * A IRMÃ DE `normalizarPeloPerfilTop` PARA A LISTA QUE MORA FORA DA CONFIGURAÇÃO (a tabela da versão, 0033): as
 * condições de pagamento permitidas que o editor do 5 manda de volta ao padrão — a lista VAZIA — antes de gravar. Só
 * quando o tipo não tem a aba Financeiro (o documento de estoque) e a lista lida tinha alguma condição: a TOP de
 * entrada gravada no 4 com condições, salva no 5. A volta nunca é silenciosa: o texto vai para o diálogo, depois das
 * de `normalizarPeloPerfilTop`. `null` em todo o resto. O servidor recusa (422) a lista não vazia no 5
 * (`recusaDasCondicoesDoPerfilTop`), a enviada e a preservada.
 */
export function condicoesQueVoltamPeloPerfilTop(perfil: PerfilDoTipoTop, quantidade: number): SecaoQueVoltaTop | null {
  if (quantidade <= 0 || perfilAceitaCondicoesTop(perfil)) return null;
  return Object.freeze({ caminho: "condicoesPermitidas", texto: TEXTO_CONDICOES_VOLTAM_TOP });
}
