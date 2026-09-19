/**
 * TOP CONFIGURADA — A CAMADA EDITÁVEL SOBRE AS FAMÍLIAS CANÔNICAS (TOP-CONFIG-01).
 *
 * DUAS COISAS DIFERENTES, E ESTE ARQUIVO É A FRONTEIRA ENTRE ELAS:
 *
 *   FAMÍLIA CANÔNICA   `tipo-operacao.ts`, em Git, imutável em runtime. É a espécie operacional que o
 *                      PRODUTO conhece e sabe executar: `vendas.venda`, `estoque.baixa`. Não é editável, não
 *                      tem CRUD, e continua sendo o SSOT.
 *   TOP CONFIGURADA    `erp.tipos_operacao`, no banco, por organização, criada pelo administrador:
 *                      "2103 — Venda de Gado a Prazo". Aponta para UMA família. Várias podem apontar para a
 *                      mesma.
 *
 * POR QUE A VALIDAÇÃO MORA AQUI E NÃO NO BANCO. O banco garante FORMA (`codigo_base ~ '^[a-z_]+\.[a-z_]+$'`)
 * e integridade de tenant; ele não pode garantir EXISTÊNCIA da família sem uma cópia da lista em SQL — e
 * essa cópia é exatamente o anti-padrão que `docs/TIPO-OPERACAO-CONTRACT.md` §10 nomeia: "a segunda lista
 * não fica desatualizada com barulho: envelhece em silêncio". Uma família nova entraria no registry e a
 * tabela de apoio continuaria recusando, ou pior, uma família removida continuaria aceita.
 *
 * Por isso a existência é conferida CONTRA O REGISTRY, em memória, na borda de escrita da API. Fail-closed:
 * família desconhecida é RECUSA (`TIPO_OPERACAO_BASE_DESCONHECIDA`), nunca cai numa família vizinha nem num
 * padrão — a mesma regra que `.claude/rules/security.md` impõe a discriminador desconhecido.
 *
 * Este arquivo NÃO executa efeito de operação, não conhece rota, não conhece permissão e não grava nada.
 * Classificar ≠ executar continua valendo, e vale mais agora: a TOP configurada é um RÓTULO de configuração
 * sobre a família, não um gancho de execução.
 */
import { CODIGOS_TIPO_OPERACAO, tipoOperacao, tipoOperacaoDeclarada } from "./tipo-operacao.js";

/** Forma aceita para o código que o usuário digita. Começa com letra ou dígito; até 20 caracteres. */
export const FORMA_CODIGO_TIPO_OPERACAO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;

export const LIMITE_NOME_TIPO_OPERACAO = 120;
export const LIMITE_DESCRICAO_TIPO_OPERACAO = 500;

/** Motivo pelo qual um candidato a TOP configurada foi recusado. Cada um vira um erro estável na API. */
export type RecusaTipoOperacaoConfigurado =
  | { motivo: "codigo_invalido" }
  | { motivo: "nome_invalido" }
  | { motivo: "descricao_invalida" }
  | { motivo: "base_desconhecida"; codigoBase: string };

/**
 * A família canônica existe? Espelha `tipoOperacaoDeclarada` de propósito, com nome que diz o PAPEL desta
 * chamada: aqui ela não valida uma referência de documentação, valida entrada de usuário na borda de escrita.
 */
export const familiaOperacionalDeclarada = (codigoBase: string): boolean => tipoOperacaoDeclarada(codigoBase);

/** Módulo da família — derivado do registry, nunca digitado junto com a TOP configurada. */
export const moduloDaFamiliaOperacional = (codigoBase: string): string | undefined =>
  tipoOperacao(codigoBase)?.modulo;

/**
 * Chave i18n do rótulo humano da família (`top.vendas.venda` → "Venda").
 *
 * A TOP configurada NÃO guarda o rótulo da família: guardá-lo seria uma cópia que envelhece quando o catálogo
 * pt-BR mudar. Guarda-se o código; o rótulo se resolve na apresentação.
 */
export const chaveI18nDaFamiliaOperacional = (codigoBase: string): string | undefined =>
  tipoOperacao(codigoBase)?.chaveI18n;

/**
 * As famílias que uma TOP configurada pode apontar. É a MESMA lista do registry, devolvida por referência —
 * não uma cópia editável, para que ninguém seja tentado a filtrar aqui o que o registry declara.
 */
export const familiasOperacionaisDisponiveis = (): readonly string[] => CODIGOS_TIPO_OPERACAO;

/** Entrada crua de uma TOP configurada, antes de qualquer confiança. */
export interface EntradaTipoOperacaoConfigurado {
  readonly codigo: string;
  readonly codigoBase: string;
  readonly nome: string;
  readonly descricao?: string | null;
}

/**
 * Valida um candidato inteiro e devolve TODAS as recusas — não só a primeira.
 *
 * Devolver só a primeira faria o usuário corrigir um campo por vez, e faria o teste de contrato provar menos
 * do que parece: um caso com dois defeitos passaria exibindo apenas um.
 */
export function validarTipoOperacaoConfigurado(e: EntradaTipoOperacaoConfigurado): RecusaTipoOperacaoConfigurado[] {
  const recusas: RecusaTipoOperacaoConfigurado[] = [];
  if (!FORMA_CODIGO_TIPO_OPERACAO.test(e.codigo)) recusas.push({ motivo: "codigo_invalido" });

  const nome = e.nome?.trim() ?? "";
  if (nome.length < 1 || nome.length > LIMITE_NOME_TIPO_OPERACAO) recusas.push({ motivo: "nome_invalido" });

  if (e.descricao != null && e.descricao.length > LIMITE_DESCRICAO_TIPO_OPERACAO) {
    recusas.push({ motivo: "descricao_invalida" });
  }

  // FAIL-CLOSED: família desconhecida NEGA. Não existe "quase igual", não existe padrão, não existe a
  // primeira da lista. Se o código não está declarado no registry, o produto não sabe executar a operação
  // que essa TOP prometeria — e uma TOP que promete o que ninguém executa é configuração morta.
  if (!familiaOperacionalDeclarada(e.codigoBase)) {
    recusas.push({ motivo: "base_desconhecida", codigoBase: e.codigoBase });
  }
  return recusas;
}
