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
 *   5. autorizar a empresa ATUAL DO REGISTRO (nunca a empresa SELECIONADA na tela: `#N` é localizador
 *      da organização, e a seleção é contexto de trabalho — ver `autorizarEscopoDoRegistro`);
 *   6. resolver rota + permissão a partir do registro atual;
 *   7. verificar a permissão;
 *   8. só então responder.
 * Toda negativa é 404 idêntica (anti-enumeração) e nenhum dado da entidade sai antes da autorização.
 *
 * Garantias: unicidade e crescimento monotônico por organização. NÃO há garantia de ausência de lacunas
 * (uma transação que aloca e falha consome o número) nem de ordem temporal perfeita entre registros criados
 * no mesmo instante — ver o contrato.
 */
import { entidadeIdGlobal, moduloDaPermissao, resolverRegistroGlobal, varianteInternaDeclarada } from "@agro/domain";
import { DomainError } from "@agro/shared";
import { colunaDiscriminadora, type EntidadeIdGlobal } from "@erp/plataforma";
import { empresaPermitida, hasPermission, type ServiceCtx } from "./context.js";
import { publicarModuloEmpresa } from "./service.js";

export interface RegistroGlobal {
  idGlobal: number;
  tipoEntidade: string;
  /** Rótulo humano do TIPO ("Solicitação de Compra"), não do registro: metadata do catálogo, não dado dele. */
  rotulo: string;
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
  const n = await alocar(ctx, exigirEntidade(tipoEntidade), tipoEntidade, idEntidade, "obrigatorio");
  if (n === null) throw new DomainError("VALIDATION_ERROR", `ID Global de ${tipoEntidade}: alocação obrigatória não produziu número`);
  return n;
}

/**
 * Alocação para quem escreve numa superfície GENÉRICA (o Resource Registry grava em dezenas de tabelas, das
 * quais só algumas são elegíveis) ou numa tabela que guarda variantes INTERNAS declaradas.
 *
 * Três respostas, e a diferença entre elas é o contrato inteiro:
 *   - entidade fora do catálogo            → `null`, sem erro: a tabela simplesmente não tem ID Global;
 *   - variante INTERNA DECLARADA           → `null`, de propósito e auditável (um `farm_transfer` é efeito
 *                                            de outra operação, não um lançamento com identidade própria);
 *   - variante DESCONHECIDA ou corrompida  → ERRO. Tratar "não achei" como "é interno" transformaria o
 *                                            esquecimento de declarar uma variante nova em silêncio
 *                                            permanente: o registro nasceria sem número e ninguém saberia.
 */
export async function atribuirIdGlobalSeAplicavel(ctx: ServiceCtx, tipoEntidade: string, idEntidade: string): Promise<number | null> {
  const entidade = entidadeIdGlobal(tipoEntidade);
  if (!entidade) return null;
  return alocar(ctx, entidade, tipoEntidade, idEntidade, "se_aplicavel");
}

/**
 * Núcleo da alocação, compartilhado pelas duas portas. Lê o registro na MESMA transação (nunca confia em
 * linha vinda do chamador), de modo que jamais se cria uma ponte global para um registro inexistente ou já
 * excluído, e grava o índice com a rota resolvida do próprio registro.
 */
async function alocar(
  ctx: ServiceCtx, entidade: EntidadeIdGlobal, tipoEntidade: string, idEntidade: string,
  modo: "obrigatorio" | "se_aplicavel"
): Promise<number | null> {
  const existente = await ctx.tx.query<{ id_global: string }>(
    "select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade=$2 and id_entidade=$3", [ctx.orgId, tipoEntidade, idEntidade]);
  if (existente.rows[0]) return Number(existente.rows[0].id_global);

  const fonte = await lerRegistroFonte(ctx, entidade, idEntidade);
  if (!fonte) throw new DomainError("VALIDATION_ERROR", `ID Global de ${tipoEntidade}: registro inexistente nesta organização`);

  const coluna = colunaDiscriminadora(entidade);
  // variante INTERNA declarada: ausência de número é a resposta certa, não uma falha
  if (modo === "se_aplicavel" && coluna && varianteInternaDeclarada(tipoEntidade, fonte.linha[coluna])) return null;

  const resolvido = resolverRegistroGlobal(tipoEntidade, idEntidade, fonte.linha);
  if (!resolvido) {
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

/** Identificador técnico das tabelas fonte. Validado ANTES da consulta: o banco nunca vê texto livre. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ESCOPO DO LOCALIZADOR GLOBAL — o ponto exato em que esta porta difere de uma rota operacional.
 *
 * Autoridade, e só ela: organização + registro fonte vivo + permissão EXATA daquele registro + empresa
 * ATUAL da fonte dentro do módulo DESSA permissão.
 *
 * A empresa SELECIONADA (o cabeçalho de contexto, `ctx.empresaId`) é deliberadamente ignorada. Ela é
 * contexto de trabalho — um filtro de tela —, e `#N` é um localizador da ORGANIZAÇÃO inteira: quem tem
 * Estoque só na empresa A e Financeiro só na B precisa localizar um título da B enquanto trabalha na A,
 * senão o localizador global não é global. Usar a seleção aqui produzia dois defeitos de uma vez:
 *   (a) FALSO NEGATIVO — o registro autorizado não abria por causa do filtro de tela;
 *   (b) ORÁCULO DE ENUMERAÇÃO — `validarEmpresaSelecionada` responde 403, e um 403 no meio de uma superfície
 *       inteiramente 404 revela que aquele número EXISTE; só o contexto é que não bate.
 * Ignorar a seleção NÃO afrouxa nada: o escopo REAL do registro continua decidindo, e registro fora dele
 * segue 404. O módulo resolvido é PUBLICADO na transação (RLS e JS falando do mesmo módulo), o que é
 * técnico; só a validação da seleção, que é regra da rota operacional, fica de fora.
 */
async function autorizarEscopoDoRegistro<C extends ServiceCtx>(ctx: C, permissao: string, empresaDoRegistro: string | null, negar: () => DomainError): Promise<C> {
  const escopado = await publicarModuloEmpresa(ctx, permissao);
  if (!(await empresaPermitida(escopado, empresaDoRegistro, moduloDaPermissao(permissao)))) throw negar();
  return escopado;
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
  //    que a rota canônica usa. O índice denormalizado nunca decide isso, e a EMPRESA SELECIONADA tampouco.
  await autorizarEscopoDoRegistro(ctx, resolvido.permissao, fonte.empresaId, naoEncontrado);
  // 8. só agora há resposta
  return {
    idGlobal: Number(indice.id_global),
    tipoEntidade: indice.tipo_entidade,
    rotulo: entidade.rotulo,
    idEntidade: indice.id_entidade,
    modulo: indice.modulo,
    rota: resolvido.rota,
    empresaId: fonte.empresaId,
    criadoEm: indice.criado_em
  };
}

/**
 * CAMINHO INVERSO: qual é o #N deste registro? É o que a tela de detalhe pergunta para exibir a identidade.
 *
 * A pergunta é oposta à de `resolverRegistro`, mas a AUTORIZAÇÃO é a mesma — e precisa ser, senão haveria
 * duas portas com dois critérios, e a mais frouxa viraria o caminho de menor resistência. Por isso aqui não
 * se autoriza pela URL da tela nem pelo índice: carrega-se o registro fonte vivo, resolve-se rota e permissão
 * a partir dele e aplicam-se capacidade e escopo de empresa ATUAL, exatamente como na resolução de `#N`.
 *
 * `tipo` só pode ser uma chave do catálogo estático; qualquer outra coisa é 404, igual a todas as negativas.
 * Registro elegível ainda SEM número (acervo histórico durante o backfill) também responde 404: a tela trata
 * ausência sem quebrar, e inventar um número aqui seria alocar fora da transação de negócio.
 */
export async function idGlobalDoRegistro(ctx: ServiceCtx, tipoEntidade: string, idEntidade: string): Promise<RegistroGlobal> {
  const naoEncontrado = () => new DomainError("NOT_FOUND", "Nenhum ID Global para este registro");
  const entidade = entidadeIdGlobal(tipoEntidade);
  if (!entidade) throw naoEncontrado();
  // O `:id` da URL vai para uma coluna `uuid`. Sem esta guarda, `/entidade/animals/nao-e-uuid` chega ao
  // PostgreSQL e volta como 500 com "invalid input syntax for type uuid" — que é, ao mesmo tempo, um erro
  // de servidor onde deveria haver uma negativa e um oráculo: a mensagem distingue "malformado" de
  // "inexistente". Aqui as duas coisas são a MESMA negativa, como todas as outras desta porta.
  if (!UUID.test(idEntidade)) throw naoEncontrado();
  const fonte = await lerRegistroFonte(ctx, entidade, idEntidade);
  if (!fonte) throw naoEncontrado();
  const resolvido = resolverRegistroGlobal(tipoEntidade, idEntidade, fonte.linha);
  if (!resolvido) throw naoEncontrado();
  if (!hasPermission(ctx, resolvido.permissao)) throw naoEncontrado();
  const escopado = await autorizarEscopoDoRegistro(ctx, resolvido.permissao, fonte.empresaId, naoEncontrado);
  const r = await escopado.tx.query<{ id_global: string; modulo: string; criado_em: string }>(
    "select id_global, modulo, criado_em from erp.registros_globais where organization_id=$1 and tipo_entidade=$2 and id_entidade=$3",
    [ctx.orgId, tipoEntidade, idEntidade]);
  const indice = r.rows[0];
  if (!indice) throw naoEncontrado();
  return {
    idGlobal: Number(indice.id_global), tipoEntidade, rotulo: entidade.rotulo, idEntidade,
    modulo: indice.modulo, rota: resolvido.rota, empresaId: fonte.empresaId, criadoEm: indice.criado_em
  };
}

/**
 * LISTAGENS — o mesmo `#N` da tela de detalhe, visível na linha (PRE-BASE2-05B.1).
 *
 * POR QUE ISTO É UMA CONSULTA SÓ, E NÃO UMA POR LINHA
 * ---------------------------------------------------
 * `idGlobalDoRegistro` existe para a tela de DETALHE: um registro, uma autorização completa. Chamá-la por
 * linha numa listagem seria N+1 — 100 linhas, 100 idas ao banco (mais as de autorização) — e transformaria
 * uma lista rápida numa lista que trava. Aqui a pergunta é outra e mais barata: "destes registros que a
 * listagem JÁ autorizou e JÁ devolveu, quais têm número?". Uma página = UMA consulta extra, com `= any($3)`.
 *
 * AUTORIZAÇÃO NÃO PASSA POR AQUI — E É DE PROPÓSITO
 * -------------------------------------------------
 * Estas linhas são o resultado de uma listagem que já aplicou permissão, escopo de empresa, RLS e exclusão
 * lógica. O ID Global é ROTULAGEM do que o usuário já está vendo: ele não pode incluir uma linha, não pode
 * excluir uma linha e não pode mudar a ordem. Se decidisse qualquer uma dessas coisas, haveria DUAS
 * autoridades de escopo na mesma resposta — e a mais frouxa venceria. A porta de `#N` (resolver e resolver
 * o inverso) continua sendo a única que autoriza, e continua intocada.
 *
 * O `null` é uma resposta legítima, não uma falha: acervo anterior ao backfill e EFEITOS internos declarados
 * (uma transferência em `animal_movements`) não têm número, e inventar um só para preencher a coluna criaria
 * identidade onde o contrato diz que não há.
 */
const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export async function anexarIdsGlobais<L extends Record<string, unknown>>(
  ctx: ServiceCtx, tipoEntidade: string, linhas: readonly L[], opts: { coluna?: string } = {}
): Promise<(L & { id_global: number | null })[]> {
  // Tipo fora do catálogo é ERRO de quem chamou (um nome digitado errado), nunca uma listagem silenciosamente
  // sem número: o gate de cobertura e este erro são o que impede uma entidade de ficar para trás.
  exigirEntidade(tipoEntidade);
  const coluna = opts.coluna ?? "id";
  const ids = [...new Set(linhas.map((l) => l[coluna]).filter(ehUuid))];
  if (!ids.length) return linhas.map((l) => ({ ...l, id_global: null }));
  const r = await ctx.tx.query<{ id_entidade: string; id_global: string }>(
    "select id_entidade, id_global from erp.registros_globais where organization_id=$1 and tipo_entidade=$2 and id_entidade = any($3::uuid[])",
    [ctx.orgId, tipoEntidade, ids]);
  const porRegistro = new Map(r.rows.map((x) => [x.id_entidade, Number(x.id_global)]));
  return linhas.map((l) => ({ ...l, id_global: ehUuid(l[coluna]) ? porRegistro.get(l[coluna]) ?? null : null }));
}

/** O que a resposta declara sobre o ID Global desta listagem. */
export interface MarcaIdGlobal {
  tipoEntidade: string;
  /** Rótulo humano do TIPO, para a tela não ter de repetir o catálogo. */
  rotulo: string;
}

/**
 * Enriquece uma PÁGINA de listagem e DECLARA, na própria resposta, que esta listagem tem ID Global.
 *
 * A declaração é o que evita uma segunda cópia do catálogo no cliente. Sem ela, a tela teria de saber, por
 * conta própria, quais das dezenas de listagens mostram a coluna — uma lista paralela que envelheceria no
 * primeiro acréscimo de entidade. Aqui a única fonte continua sendo `ENTIDADES_ID_GLOBAL`: o servidor
 * resolve e a tela apenas obedece.
 */
export async function paginaComIdGlobal<P extends { items: Record<string, unknown>[] }>(
  ctx: ServiceCtx, tipoEntidade: string, pagina: P, opts: { coluna?: string } = {}
): Promise<P & { idGlobal: MarcaIdGlobal }> {
  const entidade = exigirEntidade(tipoEntidade);
  return { ...pagina, items: await anexarIdsGlobais(ctx, tipoEntidade, pagina.items, opts), idGlobal: { tipoEntidade, rotulo: entidade.rotulo } };
}
