/**
 * TOP-CONFIG-08 — A CONFIRMAÇÃO AUTOMÁTICA (decisão 277; docs/TIPO-OPERACAO-CONTRACT.md §17).
 *
 * A versão congelada no FORMATO 4 com `geral.confirmacao = "automatica"` manda confirmar o documento ao ser
 * salvo. Este arquivo NÃO confirma nada: ele decide se a confirmação é tentada, com que capacidade, e o que
 * a resposta diz quando ela não acontece. Quem confirma é a função do POST /confirm de cada documento.
 *
 * ┌─ UM CAMINHO DE CONFIRMAÇÃO SÓ ─────────────────────────────────────────────────────────────────────┐
 * │ O `confirmar` recebido é a MESMA função do POST /confirm (`confirmarVendaNaTransacao`,             │
 * │ `confirmarCompraNaTransacao`, `confirmarDocumentoEstoqueNaTransacao`), com `automatica: true`:     │
 * │ mesmo planejamento, mesmas recusas (situação, política, aprovação, exigências, período, saldo),     │
 * │ mesmos efeitos e a mesma auditoria "confirm" — só com a chave `automatica: true` a mais. Uma        │
 * │ segunda confirmação "equivalente" divergiria da primeira na primeira fatia que mexesse numa delas. │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ QUEM CONFIRMA, E COM QUE PODER ───────────────────────────────────────────────────────────────────┐
 * │ Quem salvou (ou, nas rotas de aprovação, quem aprovou), com a MESMA capacidade da confirmação      │
 * │ manual: `sales.edit`, `compras.edit`, `<recurso da espécie>.edit`. É capacidade do MESMO recurso   │
 * │ que gravou, então cai no mesmo módulo de escopo empresarial da requisição: `hasPermission` basta,  │
 * │ sem publicar outro módulo. A TOP NUNCA DÁ PODER: sem a capacidade, nada é tentado — nem o          │
 * │ savepoint —, o documento fica salvo e aberto, e a resposta diz "sem_permissao".                    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE O SAVEPOINT ──────────────────────────────────────────────────────────────────────────────┐
 * │ A confirmação roda NA MESMA TRANSAÇÃO da gravação (o documento ainda nem foi commitado), e a        │
 * │ recusa dela não pode desfazer o que foi salvo: a regra é "salvo e aberto, com o motivo". Sem o     │
 * │ savepoint, só restariam dois erros: (a) a recusa sobe e a transação inteira volta — o usuário      │
 * │ perde o documento que digitou; (b) a recusa é engolida — e o que a confirmação já escreveu antes   │
 * │ de recusar (movimento, título, a MARCA da 0023/0024) seria commitado junto. Depois de um erro do   │
 * │ Postgres a transação fica ABORTADA ("current transaction is aborted") e só o `rollback to         │
 * │ savepoint` a recupera; e o `set_config(..., true)` das marcas, feito dentro do savepoint, é        │
 * │ desfeito pelo mesmo rollback (o GUC local volta ao valor de antes do savepoint). Por isso o        │
 * │ rollback vem SEMPRE primeiro, antes de olhar o erro. As travas pegas DENTRO do savepoint (saldo,   │
 * │ produto) também são soltas por ele; as de antes (o documento, o contador) ficam até o commit.     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O QUE VIRA "recusada", E O QUE SOBE ──────────────────────────────────────────────────────────────┐
 * │ APROVACAO_PENDENTE        → "aguardando_aprovacao": não é defeito do documento, é o passo seguinte │
 * │                             (a decisão de quem aprova) que falta. O planejamento para ANTES de     │
 * │                             qualquer efeito.                                                        │
 * │ outro DomainError, ou o   → "recusada", com o MESMO corpo de erro que o /confirm devolveria        │
 * │ que o `fromPgError`         (`{ code, message, details? }` — o `toJSON` que o plugin de erros põe   │
 * │ traduz                      em `{ error }`). Inclui a reprovação vigente, a guarda do banco         │
 * │                             (CONFLICT), o período fechado e o 40P01/40001 (CONCURRENCY_CONFLICT).  │
 * │ qualquer outro erro       → SOBE, depois do rollback ao savepoint: o 500 de hoje, e a transação    │
 * │ (bug, conexão, ZodError)    inteira volta, documento incluído. Engolir um erro que ninguém entende │
 * │                             como "recusada" commitaria um documento depois de uma falha            │
 * │                             desconhecida. O ZodError aqui não é entrada do usuário (o corpo já foi │
 * │                             lido): é o documento gravado fora do esquema.                           │
 * │ Este arquivo NUNCA lança DomainError: a gravação que chegou até aqui já foi aceita.                 │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AS TRAVAS (risco declarado; SPEC §3 "TRAVAS") ────────────────────────────────────────────────────┐
 * │ Venda: a confirmação manual trava documento → saldo/produto (`postStock`) → contador do ID Global  │
 * │ (`createTitles`). O POST e a conversão já pegaram o contador (`writeDoc`) ANTES de chegar ao       │
 * │ produto, então uma confirmação manual de outra venda do mesmo produto pode dar deadlock (40P01). A │
 * │ ordem da manual NÃO muda: o Postgres escolhe uma vítima; se for a automática, o savepoint a desfaz │
 * │ e a venda fica salva e aberta com "recusada" (CONCURRENCY_CONFLICT); se for a manual, ela recebe o │
 * │ 409 de hoje. Compra (código → INSERT → ID Global → itens → estoque → título; a manual: documento → │
 * │ ID Global → estoque) e estoque (a manual nem pega o contador) não têm ciclo.                       │
 * │ O CUSTO: o contador do ID Global da organização fica preso durante a confirmação automática        │
 * │ inteira (estoque, títulos, auditoria), e os lançamentos da organização esperam por ele até o       │
 * │ commit.                                                                                             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { ZodError } from "zod";
import { DomainError } from "@agro/shared";
import { regrasGeraisDaVersaoTop } from "@agro/domain";
import { hasPermission, type ServiceCtx } from "./context.js";
import { fromPgError } from "./errors.js";

/** O resultado que a resposta da gravação carrega em `confirmacaoAutomatica` — só com versão formato 4 Automática. */
export type ResultadoConfirmacaoAutomatica =
  | { confirmado: true }
  | { confirmado: false; motivo: "aguardando_aprovacao" }
  | { confirmado: false; motivo: "sem_permissao" }
  | { confirmado: false; motivo: "recusada"; erro: { code: string; message: string; details?: unknown } };

/** Nome FIXO: o gancho roda uma vez por requisição, no fim do caminho, e nunca aninhado em outro. */
const SAVEPOINT = "confirmacao_automatica";

/**
 * A recusa que o plugin de erros transformaria em resposta de domínio, ou `null` para o que ele trataria
 * como falha (500). O ZodError fica de fora de propósito (ver o cabeçalho), mesmo que o `fromPgError` já
 * não o reconheça: a decisão não pode depender de um detalhe dele.
 */
function recusaDeDominio(e: unknown): DomainError | null {
  if (e instanceof DomainError) return e;
  if (e instanceof ZodError) return null;
  return fromPgError(e);
}

/** O corpo de `{ error }` do /confirm: `code` e `message`, e `details` só quando existe (o JSON o omite). */
function corpoDoErro(e: DomainError): { code: string; message: string; details?: unknown } {
  const { code, message, details } = e.toJSON();
  return details === undefined ? { code, message } : { code, message, details };
}

/**
 * TENTA confirmar o documento recém-gravado, num savepoint da transação de quem chama.
 *
 * Quem chama já sabe que a versão congelada é formato 4 com Confirmação Automática (`confirmaAutomaticamente`)
 * e chama isto NO FIM do caminho que grava (depois da auditoria "create", da conversão ou do receber).
 * `permissao` é a capacidade da confirmação MANUAL daquele documento; `confirmar` é a função do /confirm.
 */
export async function tentarConfirmacaoAutomatica(
  ctx: ServiceCtx,
  o: { permissao: string; confirmar: () => Promise<unknown> },
): Promise<ResultadoConfirmacaoAutomatica> {
  if (!hasPermission(ctx, o.permissao)) return { confirmado: false, motivo: "sem_permissao" };

  // Fora do `try`: se o próprio savepoint falhar, não há para onde voltar, e a falha sobe como está.
  await ctx.tx.query(`savepoint ${SAVEPOINT}`);
  try {
    await o.confirmar();
    await ctx.tx.query(`release savepoint ${SAVEPOINT}`);
    return { confirmado: true };
  } catch (e) {
    // PRIMEIRO desfazer, depois classificar: a transação pode estar abortada, e só este rollback a devolve
    // viva (com as marcas de `set_config` desfeitas junto). O `release` em seguida fecha a subtransação, como
    // a importação faz — o rollback a deixa aberta. Se o rollback falhar (conexão perdida), a falha sobe: não
    // existe "recusada" sobre uma transação morta.
    await ctx.tx.query(`rollback to savepoint ${SAVEPOINT}`);
    await ctx.tx.query(`release savepoint ${SAVEPOINT}`);
    const recusa = recusaDeDominio(e);
    if (!recusa) throw e;
    if (recusa.code === "APROVACAO_PENDENTE") return { confirmado: false, motivo: "aguardando_aprovacao" };
    return { confirmado: false, motivo: "recusada", erro: corpoDoErro(recusa) };
  }
}

/**
 * A VERSÃO CONGELADA (configuração + família) que o documento cita — UMA consulta, o molde de `politicaDaVenda`.
 *
 * Pela linha EXATA de `erp.tipos_operacao_versoes`, nunca pela `versao_atual` do pai: a TOP pode ter sido
 * editada depois do lançamento. Do pai sai só a FAMÍLIA, que é imutável. SEM FILTRO DE ESTADO no pai (desativar
 * ou excluir a TOP não troca a versão que o documento capturou) e SEM LOCK (a versão é imutável, e `for share`
 * exigiria o privilégio que a 0020 revogou). `null` = documento sem TOP.
 */
export async function lerVersaoCongeladaTop(ctx: ServiceCtx, versaoId: string | null): Promise<{ codigoBase: string; configuracao: unknown } | null> {
  if (!versaoId) return null;
  const r = await ctx.tx.query<{ configuracao: unknown; codigo_base: string }>(
    `select v.configuracao, t.codigo_base
       from erp.tipos_operacao_versoes v
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.organization_id = v.organization_id
      where v.id = $1 and v.organization_id = $2`,
    [versaoId, ctx.orgId]);
  const linha = r.rows[0];
  // As FKs compostas e a RLS do mesmo tenant tornam este caminho inalcançável enquanto o documento for visível.
  // Alcançado, é corrupção — e decidir "então não tem TOP" seria o fallback proibido. A mesma recusa da venda.
  if (!linha) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
  return { codigoBase: linha.codigo_base, configuracao: linha.configuracao };
}

/**
 * O documento com esta versão congelada CONFIRMA SOZINHO? `true` só com o formato 4 legível e
 * `geral.confirmacao = "automatica"`; formato 1 a 3 (mesmo com "automatica" gravado, como o pedido de compra de
 * produção) e documento sem TOP → `false`: é o corte da decisão 277. Ilegível → `false`: não se tenta confirmar o
 * que ninguém sabe ler, e a confirmação manual recusa como hoje (TIPO_OPERACAO_EXECUCAO_INDISPONIVEL).
 *
 * Responde só pela VERSÃO. A variante é de quem chama: na venda, só `kind = "sale"` confirma — os handlers servem
 * às três variantes, e a execução não reaplica a matriz da gravação.
 */
export async function confirmaAutomaticamente(ctx: ServiceCtx, versaoId: string | null): Promise<boolean> {
  const r = regrasGeraisDaVersaoTop(await lerVersaoCongeladaTop(ctx, versaoId));
  return r.ok && r.regras.confirmacaoAutomatica;
}
