/**
 * SERVIÇO DE ID GLOBAL (docs/GLOBAL-ID-CONTRACT.md).
 *
 * Alocação é sempre do BANCO (`erp.proximo_id_global`), dentro da transação do serviço, e a elegibilidade
 * vem do catálogo de produto (`@agro/domain`) sobre o mecanismo neutro (`@erp/plataforma`) — nunca de `if`
 * na rota.
 *
 * O REGISTRO FONTE É A AUTORIDADE
 * -------------------------------
 * `erp.registros_globais.empresa_id` é ÍNDICE DENORMALIZADO (navegação, diagnóstico), NUNCA autoridade de
 * segurança: um animal transferido de empresa mantém o índice antigo. Por isso toda resolução carrega o
 * REGISTRO FONTE VIVO e dele tira empresa atual, discriminador e existência. A ordem é fixa:
 *   1. localizar o índice global dentro da organização;
 *   2. identificar a entidade no catálogo;
 *   3. carregar o registro fonte vivo (tabela LITERAL do catálogo, id parametrizado, organization_id);
 *   4. obter do registro: empresa ATUAL, discriminador e existência/visibilidade;
 *   5. autorizar a empresa ATUAL;
 *   6. resolver rota + permissão a partir do registro atual;
 *   7. verificar a permissão;
 *   8. só então responder.
 * Toda negativa é 404 idêntica (anti-enumeração) e nenhum dado da entidade sai antes da autorização.
 *
 * Garantias: unicidade e crescimento monotônico por organização. NÃO há garantia de ausência de lacunas
 * (uma transação que aloca e falha consome o número) nem de ordem temporal perfeita entre registros criados
 * no mesmo instante — ver o contrato.
 */
import { entidadeIdGlobal, moduloDaPermissao, resolverRegistroGlobal } from "@agro/domain";
import { DomainError } from "@agro/shared";
import { colunaDiscriminadora, type EntidadeIdGlobal } from "@erp/plataforma";
import { empresaPermitida, hasPermission, type ServiceCtx } from "./context.js";
import { validarEmpresaSelecionada } from "./service.js";

export interface RegistroGlobal {
  idGlobal: number;
  tipoEntidade: string;
  idEntidade: string;
  modulo: string;
  rota: string;
  empresaId: string | null;
  criadoEm: string;
}

const exigirEntidade = (tipoEntidade: string): EntidadeIdGlobal => {
  const entidade = entidadeIdGlobal(tipoEntidade);
  if (!entidade) throw new DomainError("VALIDATION_ERROR", `Tipo de entidade sem ID Global: ${tipoEntidade}`);
  return entidade;
};

/** Registro fonte vivo: o que a tabela real diz AGORA sobre empresa, variante e existência. */
interface RegistroFonte {
  /** Empresa ATUAL do registro (null quando a entidade é compartilhada pela organização). */
  empresaId: string | null;
  /** Colunas lidas (discriminador quando houver) para resolver rota e permissão. */
  linha: Record<string, unknown>;
}

/**
 * Carrega o registro fonte. Tabela e colunas são LITERAIS do catálogo (lista branca estática), nunca entrada
 * do usuário; o id vai parametrizado. Quando a tabela tem exclusão lógica, registro excluído NÃO existe aqui
 * — o resolvedor enxerga exatamente o que a rota canônica enxerga (cancelado ≠ excluído: cancelado continua
 * existindo e continua navegável). Devolve `null` quando o registro não existe ou não é mais visível.
 */
async function lerRegistroFonte(ctx: ServiceCtx, entidade: EntidadeIdGlobal, idEntidade: string): Promise<RegistroFonte | null> {
  const discriminador = colunaDiscriminadora(entidade);
  const colunas = ["id", ...(entidade.colunaEmpresa ? [entidade.colunaEmpresa] : []), ...(discriminador ? [discriminador] : [])];
  const filtroExclusao = entidade.exclusaoLogica ? " and deleted_at is null" : "";
  const r = await ctx.tx.query<Record<string, unknown>>(
    `select ${colunas.join(", ")} from ${entidade.tabela} where id=$1 and organization_id=$2${filtroExclusao}`,
    [idEntidade, ctx.orgId]);
  const linha = r.rows[0];
  if (!linha) return null;
  return {
    empresaId: entidade.colunaEmpresa ? ((linha[entidade.colunaEmpresa] as string | null | undefined) ?? null) : null,
    linha
  };
}

/**
 * Atribui (ou devolve, se já existir) o ID Global do registro. Idempotente por (organização, tipo, registro).
 * NÃO confia em linha vinda do chamador: o registro é lido na MESMA transação, de modo que nunca se cria uma
 * ponte global para um registro inexistente (ou já excluído).
 */
export async function atribuirIdGlobal(ctx: ServiceCtx, tipoEntidade: string, idEntidade: string): Promise<number> {
  const entidade = exigirEntidade(tipoEntidade);
  const existente = await ctx.tx.query<{ id_global: string }>(
    "select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade=$2 and id_entidade=$3", [ctx.orgId, tipoEntidade, idEntidade]);
  if (existente.rows[0]) return Number(existente.rows[0].id_global);

  const fonte = await lerRegistroFonte(ctx, entidade, idEntidade);
  if (!fonte) throw new DomainError("VALIDATION_ERROR", `ID Global de ${tipoEntidade}: registro inexistente nesta organização`);

  const resolvido = resolverRegistroGlobal(tipoEntidade, idEntidade, fonte.linha);
  if (!resolvido) {
    const coluna = colunaDiscriminadora(entidade);
    throw new DomainError("VALIDATION_ERROR", coluna
      ? `ID Global de ${tipoEntidade}: valor de ${coluna} sem tela canônica declarada`
      : `ID Global de ${tipoEntidade}: não foi possível resolver a rota canônica`);
  }

  const inserido = await ctx.tx.query<{ id_global: string }>(
    `insert into erp.registros_globais (organization_id, id_global, tipo_entidade, id_entidade, empresa_id, modulo, rota_canonica, criado_por)
     values ($1, erp.proximo_id_global($1), $2, $3, $4, $5, $6, $7)
     on conflict (organization_id, tipo_entidade, id_entidade) do nothing
     returning id_global`,
    [ctx.orgId, tipoEntidade, idEntidade, fonte.empresaId, entidade.modulo, resolvido.rota, ctx.user.id]);
  if (inserido.rows[0]) return Number(inserido.rows[0].id_global);
  // corrida: outra transação gravou primeiro — o ID dela é o válido
  const corrida = await ctx.tx.query<{ id_global: string }>(
    "select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade=$2 and id_entidade=$3", [ctx.orgId, tipoEntidade, idEntidade]);
  if (!corrida.rows[0]) throw new DomainError("CONCURRENCY_CONFLICT", "Não foi possível alocar o ID Global");
  return Number(corrida.rows[0].id_global);
}

/**
 * Resolve `#N` no registro real. Responde NOT_FOUND — sem distinguir os motivos, para não expor existência —
 * quando o número não existe na organização, quando o registro sumiu (ou foi excluído), quando o usuário está
 * fora do escopo da empresa ATUAL do registro e quando lhe falta a permissão DAQUELE registro (não a de uma
 * tela vizinha).
 */
export async function resolverRegistro(ctx: ServiceCtx, idGlobal: number): Promise<RegistroGlobal> {
  const naoEncontrado = () => new DomainError("NOT_FOUND", "Nenhum registro encontrado para este ID Global");
  // 1. índice global dentro da organização
  const r = await ctx.tx.query<{ id_global: string; tipo_entidade: string; id_entidade: string; modulo: string; criado_em: string }>(
    "select id_global, tipo_entidade, id_entidade, modulo, criado_em from erp.registros_globais where organization_id=$1 and id_global=$2",
    [ctx.orgId, idGlobal]);
  const indice = r.rows[0];
  if (!indice) throw naoEncontrado();
  // 2. entidade no catálogo
  const entidade = entidadeIdGlobal(indice.tipo_entidade);
  if (!entidade) throw naoEncontrado();
  // 3-4. registro fonte vivo: empresa atual, discriminador, existência
  const fonte = await lerRegistroFonte(ctx, entidade, indice.id_entidade);
  if (!fonte) throw naoEncontrado();
  // 5. rota + permissão do registro atual, sempre juntas
  const resolvido = resolverRegistroGlobal(indice.tipo_entidade, indice.id_entidade, fonte.linha);
  if (!resolvido) throw naoEncontrado();
  // 6. CAPACIDADE: a permissão daquele registro
  if (!hasPermission(ctx, resolvido.permissao)) throw naoEncontrado();
  // 7. ESCOPO: a empresa ATUAL do registro dentro do MÓDULO DESSA MESMA PERMISSÃO — a mesma fonte funcional
  //    que a rota canônica usa. O índice denormalizado nunca decide isso.
  const moduloDoRegistro = moduloDaPermissao(resolvido.permissao);
  await validarEmpresaSelecionada({ ...ctx, moduloEmpresa: moduloDoRegistro });
  if (!(await empresaPermitida(ctx, fonte.empresaId, moduloDoRegistro))) throw naoEncontrado();
  // 8. só agora há resposta
  return {
    idGlobal: Number(indice.id_global),
    tipoEntidade: indice.tipo_entidade,
    idEntidade: indice.id_entidade,
    modulo: indice.modulo,
    rota: resolvido.rota,
    empresaId: fonte.empresaId,
    criadoEm: indice.criado_em
  };
}
