/**
 * OPERACOES-01 F10 (decisão 287) — A TOP NOS MÓDULOS COM PRODUTO: a peça comum das rotas dos seis módulos.
 *
 * Abastecimento, manutenção, ordem de serviço, manejo, batelada e produção de ração passam a citar a TOP no PRÓPRIO
 * registro (`tipo_operacao_id` + `tipo_operacao_versao_id`, colunas anuláveis da migration dos módulos com TOP). Cada
 * rota continua dona da sua regra — esta peça só responde as quatro perguntas que todas fazem igual:
 *   1. QUAIS TOPs o módulo pode lançar (`GET /api/modulos/<segmento>/operation-types`, a capacidade `topNoModulo`);
 *   2. QUAL TOP este lançamento cita — sem `tipo_operacao_id`, nenhuma (o lançamento de hoje); com ele, a versão
 *      corrente congelada pelo servidor (`resolverTopParaLancamento`, a mesma superfície única de recusa da venda) e as
 *      EXIGÊNCIAS GERAIS que o registro do módulo tem (o mapa do domínio, `EXIGENCIAS_GERAIS_DOS_MODULOS_TOP`);
 *   3. as mesmas exigências pela versão JÁ congelada (o PUT da OS, que edita sem trocar a TOP);
 *   4. o JOIN do nome da TOP congelada para os detalhes.
 *
 * CLASSIFICAR ≠ EXECUTAR: nada daqui move estoque, gera título ou liga a seção Destino; formato ilegível = nenhuma
 * exigência (como no documento de estoque — quem lê a versão é a exigência, não a execução). A família de cada módulo
 * é PERGUNTADA ao registry (`familiaDoModuloComTop`): nenhum código de família escrito aqui.
 */
import { DomainError } from "@agro/shared";
import {
  CAPACIDADE_TOP_NO_MODULO,
  ERRO_EXIGENCIA_NAO_ATENDIDA,
  EXIGENCIAS_GERAIS_DOS_MODULOS_TOP,
  MENSAGEM_EXIGENCIA_NAO_ATENDIDA,
  camposExigidosTop,
  chaveI18nDaFamiliaOperacional,
  exigenciasGeraisFaltando,
  familiaDoModuloComTop,
  lerConfiguracaoTop,
  restricoesExecutamTop,
  type ModuloComTop,
} from "@agro/domain";
import { criarTradutor, ptBR } from "@erp/plataforma";
import { resolverTopParaLancamento, type TopDoLancamento } from "./documento-comercial.js";
import { lerVersaoCongeladaTop } from "./confirmacao-automatica.js";
import type { ServiceCtx } from "./context.js";

const t = criarTradutor(ptBR);

/** Uma TOP que o módulo pode lançar, com os campos que a versão corrente dela EXIGE (as colunas do registro). */
export interface TipoDeOperacaoDoModulo {
  id: string;
  code: string;
  name: string;
  version: number;
  isDefault: boolean;
  camposExigidos: string[];
}

/** A resposta de `GET /api/modulos/<segmento>/operation-types`. */
export interface TiposDeOperacaoDoModulo {
  contractVersion: 1;
  capacidades: { topNoModulo: typeof CAPACIDADE_TOP_NO_MODULO };
  family: { code: string; label: string } | null;
  defaultId: string | null;
  items: TipoDeOperacaoDoModulo[];
}

/** Os campos do registro que a configuração exige (formato 3, 4 e 5); ilegível ou 1/2 → nenhum. */
function camposExigidosDaConfiguracao(modulo: ModuloComTop, configuracao: unknown): string[] {
  const lida = lerConfiguracaoTop(configuracao);
  if (!lida.ok || !restricoesExecutamTop(lida.valor)) return [];
  return camposExigidosTop(lida.valor, EXIGENCIAS_GERAIS_DOS_MODULOS_TOP[modulo]);
}

/**
 * As TOPs da família do módulo — ativas, não excluídas, da organização —, a padrão primeiro. UMA consulta (o pai, a
 * versão corrente e a configuração dela), no molde da descoberta do documento de estoque. Família ausente no registry
 * (fail-closed) → `family: null` e nenhuma TOP, sem consulta.
 */
export async function tiposDeOperacaoDoModulo(ctx: ServiceCtx, modulo: ModuloComTop): Promise<TiposDeOperacaoDoModulo> {
  const familia = familiaDoModuloComTop(modulo);
  const capacidades = { topNoModulo: CAPACIDADE_TOP_NO_MODULO };
  if (!familia) return { contractVersion: 1, capacidades, family: null, defaultId: null, items: [] };
  const r = await ctx.tx.query<{ id: string; codigo: string; nome: string; versao: number; padrao: boolean; configuracao: unknown }>(
    `select t.id, t.codigo, v.nome, v.versao, t.padrao, v.configuracao
       from erp.tipos_operacao t
       join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
      where t.organization_id = $1 and t.codigo_base = $2 and t.ativo and t.excluido_em is null
      order by t.padrao desc, t.codigo, v.nome`, [ctx.orgId, familia]);
  return {
    contractVersion: 1,
    capacidades,
    family: { code: familia, label: t(chaveI18nDaFamiliaOperacional(familia) ?? familia) },
    defaultId: r.rows.find((x) => x.padrao)?.id ?? null,
    items: r.rows.map((x) => ({
      id: x.id, code: x.codigo, name: x.nome, version: x.versao, isDefault: x.padrao,
      camposExigidos: camposExigidosDaConfiguracao(modulo, x.configuracao),
    })),
  };
}

/**
 * As exigências gerais da configuração sobre o registro do módulo: faltou alguma → 422
 * `TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA` com `{ exigencias: [{ caminho, mensagem }] }` (o molde do documento de
 * estoque). Formato 1/2 e ilegível → nada.
 */
function cobrarExigencias(modulo: ModuloComTop, configuracao: unknown, documento: Readonly<Record<string, unknown>>): void {
  const lida = lerConfiguracaoTop(configuracao);
  if (!lida.ok || !restricoesExecutamTop(lida.valor)) return;
  const faltando = exigenciasGeraisFaltando(lida.valor, documento, EXIGENCIAS_GERAIS_DOS_MODULOS_TOP[modulo]);
  if (!faltando.length) return;
  throw new DomainError(ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA,
    { exigencias: faltando.map((x) => ({ caminho: x.caminho, mensagem: `${x.rotulo} é obrigatório nesta operação.` })) });
}

/**
 * A TOP DO LANÇAMENTO. Sem `tipoOperacaoId` → `null` (o lançamento de hoje, sem TOP). Com ele: a família do módulo no
 * registry (ausente → 422 `TIPO_OPERACAO_INDISPONIVEL`); `resolverTopParaLancamento` (congela a versão corrente;
 * inexistente, de outra organização, de outra família, inativa e excluída → o MESMO 422); a configuração da versão
 * lida UMA vez; formato 3, 4 e 5 → as exigências do mapa do módulo sobre `documento` (só as colunas que o registro
 * tem). Quem chama faz isto ANTES do número do registro: a recusa não queima código.
 */
export async function topDoLancamentoDoModulo(
  ctx: ServiceCtx,
  modulo: ModuloComTop,
  tipoOperacaoId: string | null | undefined,
  documento: Readonly<Record<string, unknown>>,
): Promise<TopDoLancamento | null> {
  if (!tipoOperacaoId) return null;
  const familia = familiaDoModuloComTop(modulo);
  if (!familia) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento");
  const top = await resolverTopParaLancamento(ctx, familia, tipoOperacaoId);
  const v = await ctx.tx.query<{ configuracao: unknown }>(
    "select configuracao from erp.tipos_operacao_versoes where id = $1 and organization_id = $2", [top.tipoOperacaoVersaoId, ctx.orgId]);
  cobrarExigencias(modulo, v.rows[0]?.configuracao ?? null, documento);
  return top;
}

/**
 * As exigências da versão CONGELADA no registro (o PUT da OS edita sem trocar a TOP): versão nula → nada (registro
 * sem TOP, como hoje); senão as mesmas recusas do lançamento, pela linha exata da versão (`lerVersaoCongeladaTop`).
 */
export async function cobrarExigenciasDaVersaoDoModulo(
  ctx: ServiceCtx,
  modulo: ModuloComTop,
  versaoId: string | null,
  documento: Readonly<Record<string, unknown>>,
): Promise<void> {
  const versao = await lerVersaoCongeladaTop(ctx, versaoId);
  if (!versao) return;
  cobrarExigencias(modulo, versao.configuracao, documento);
}

/** O alias de tabela que o JOIN aceita: identificador simples do próprio código, nunca entrada do usuário. */
const ALIAS_SQL = /^[a-z_][a-z0-9_]*$/;

/**
 * O JOIN do nome da TOP congelada para os detalhes (`left join`: registro sem TOP continua aparecendo, com nome e
 * versão nulos). `alias` é o da tabela do módulo na consulta de quem chama (ex.: `"s"`); a versão é a do tenant do
 * próprio registro. Alias fora da forma de identificador simples lança — é erro de programação, não de dado.
 */
export const joinDaTopDoModulo = (alias: string): { join: string; colunas: string } => {
  if (!ALIAS_SQL.test(alias)) throw new Error(`joinDaTopDoModulo: alias inválido "${alias}"`);
  return {
    join: `left join erp.tipos_operacao_versoes tov on tov.id = ${alias}.tipo_operacao_versao_id and tov.organization_id = ${alias}.organization_id`,
    colunas: "tov.nome as tipo_operacao_nome, tov.versao as tipo_operacao_versao",
  };
};
