/**
 * SERVIÇO DE ID GLOBAL (docs/GLOBAL-ID-CONTRACT.md).
 *
 * Alocação é sempre do BANCO (`erp.proximo_id_global`), dentro da transação do serviço, e a elegibilidade
 * vem do registry central de `@erp/plataforma` — nunca de `if` na rota.
 *
 * PERMISSÃO É DO REGISTRO. Em entidades cuja tabela atende a mais de uma tela (título a pagar × a receber,
 * orçamento × pedido × venda, cada tipo de manejo e de movimentação), rota e permissão são resolvidas
 * JUNTAS, a partir da coluna discriminadora do PRÓPRIO REGISTRO lido do banco — nunca da URL, nunca de um
 * valor gravado que possa envelhecer, e nunca por uma permissão mais ampla que cubra as duas telas.
 *
 * Garantias: unicidade e crescimento monotônico por organização. NÃO há garantia de ausência de lacunas
 * (uma transação que aloca e falha consome o número) nem de ordem temporal perfeita entre registros criados
 * no mesmo instante — ver o contrato.
 */
import { DomainError } from "@agro/shared";
import { colunaDiscriminadora, entidadeIdGlobal, resolverRegistroGlobal, type EntidadeIdGlobal } from "@erp/plataforma";
import { farmAllowed, hasPermission, type ServiceCtx } from "./context.js";

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

/**
 * Lê a coluna discriminadora direto da tabela da entidade. A tabela e a coluna são LITERAIS do registry
 * (lista branca estática), nunca entrada do usuário — o id vai parametrizado.
 */
async function lerDiscriminador(ctx: ServiceCtx, entidade: EntidadeIdGlobal, idEntidade: string): Promise<Record<string, unknown> | null> {
  const coluna = colunaDiscriminadora(entidade);
  if (!coluna) return {};
  const r = await ctx.tx.query<Record<string, unknown>>(
    `select ${coluna} from ${entidade.tabela} where id=$1 and organization_id=$2`, [idEntidade, ctx.orgId]);
  return r.rows[0] ?? null;
}

/**
 * Atribui (ou devolve, se já existir) o ID Global do registro. Idempotente por (organização, tipo, registro).
 * `linha` é a própria linha gravada: dela saem a empresa e o discriminador que decide rota e permissão.
 */
export async function atribuirIdGlobal(ctx: ServiceCtx, tipoEntidade: string, idEntidade: string, linha: Readonly<Record<string, unknown>> = {}): Promise<number> {
  const entidade = exigirEntidade(tipoEntidade);
  const existente = await ctx.tx.query<{ id_global: string }>(
    "select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade=$2 and id_entidade=$3", [ctx.orgId, tipoEntidade, idEntidade]);
  if (existente.rows[0]) return Number(existente.rows[0].id_global);

  const resolvido = resolverRegistroGlobal(tipoEntidade, idEntidade, linha);
  if (!resolvido) {
    const coluna = colunaDiscriminadora(entidade);
    throw new DomainError("VALIDATION_ERROR", coluna
      ? `ID Global de ${tipoEntidade}: valor de ${coluna} sem tela canônica declarada`
      : `ID Global de ${tipoEntidade}: não foi possível resolver a rota canônica`);
  }
  const empresaId = entidade.colunaEmpresa ? ((linha[entidade.colunaEmpresa] as string | null | undefined) ?? null) : null;

  const inserido = await ctx.tx.query<{ id_global: string }>(
    `insert into erp.registros_globais (organization_id, id_global, tipo_entidade, id_entidade, empresa_id, modulo, rota_canonica, criado_por)
     values ($1, erp.proximo_id_global($1), $2, $3, $4, $5, $6, $7)
     on conflict (organization_id, tipo_entidade, id_entidade) do nothing
     returning id_global`,
    [ctx.orgId, tipoEntidade, idEntidade, empresaId, entidade.modulo, resolvido.rota, ctx.user.id]);
  if (inserido.rows[0]) return Number(inserido.rows[0].id_global);
  // corrida: outra transação gravou primeiro — o ID dela é o válido
  const corrida = await ctx.tx.query<{ id_global: string }>(
    "select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade=$2 and id_entidade=$3", [ctx.orgId, tipoEntidade, idEntidade]);
  if (!corrida.rows[0]) throw new DomainError("CONCURRENCY_CONFLICT", "Não foi possível alocar o ID Global");
  return Number(corrida.rows[0].id_global);
}

/**
 * Resolve `#N` no registro real. Responde NOT_FOUND — sem distinguir os motivos, para não expor existência —
 * quando o número não existe na organização, quando o registro sumiu, quando o usuário está fora do escopo de
 * empresa e quando lhe falta a permissão DAQUELE registro (não a de uma tela vizinha).
 */
export async function resolverRegistro(ctx: ServiceCtx, idGlobal: number): Promise<RegistroGlobal> {
  const naoEncontrado = () => new DomainError("NOT_FOUND", "Nenhum registro encontrado para este ID Global");
  const r = await ctx.tx.query<{ id_global: string; tipo_entidade: string; id_entidade: string; empresa_id: string | null; modulo: string; rota_canonica: string; criado_em: string }>(
    "select id_global, tipo_entidade, id_entidade, empresa_id, modulo, rota_canonica, criado_em from erp.registros_globais where organization_id=$1 and id_global=$2",
    [ctx.orgId, idGlobal]);
  const linha = r.rows[0];
  if (!linha) throw naoEncontrado();
  const entidade = entidadeIdGlobal(linha.tipo_entidade);
  if (!entidade) throw naoEncontrado();
  // escopo de empresa antes de qualquer consulta adicional
  if (!farmAllowed(ctx, linha.empresa_id)) throw naoEncontrado();
  // o discriminador vem do registro VIVO: rota e permissão nunca ficam desatualizadas nem divergem entre si
  const registro = await lerDiscriminador(ctx, entidade, linha.id_entidade);
  if (!registro) throw naoEncontrado();
  const resolvido = resolverRegistroGlobal(linha.tipo_entidade, linha.id_entidade, registro);
  if (!resolvido) throw naoEncontrado();
  if (!hasPermission(ctx, resolvido.permissao)) throw naoEncontrado();
  return {
    idGlobal: Number(linha.id_global),
    tipoEntidade: linha.tipo_entidade,
    idEntidade: linha.id_entidade,
    modulo: linha.modulo,
    rota: resolvido.rota,
    empresaId: linha.empresa_id,
    criadoEm: linha.criado_em
  };
}
