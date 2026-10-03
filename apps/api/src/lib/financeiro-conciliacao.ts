import { D, money, sum } from "@agro/shared";
import { FORMA_UUID_PADRAO, contaDoOfxConfere, lerOfx, sugerirConciliacao } from "@agro/domain";
import type { ServiceCtx } from "./context.js";
import { audit, nextCode } from "./service.js";
import { DomainError, err, notFound, validation } from "./errors.js";
import { atribuirIdGlobal } from "./id-global.js";

/**
 * CONCILIAÇÃO OFX DA CENTRAL FINANCEIRA (OPERACOES-01 F8, decisão 285).
 *
 * A importação e as transações são da CONTA, e a conta é da ORGANIZAÇÃO (`erp.ofx_imports`/`erp.ofx_transactions`
 * só têm a política de tenant). Os MOVIMENTOS que se vinculam são de EMPRESA: toda leitura e toda escrita neles
 * passa pela RLS do módulo financeiro (a permissão `ofx_imports.*` é desse módulo), e toda escrita confere o ROW
 * COUNT — fora do escopo a RLS devolve zero linhas, e zero linha sem conferência viraria "conciliado" sem efeito.
 *
 * A marca de conciliado mora no MOVIMENTO (`reconciled_at`, `ofx_transaction_id`); a transação guarda a sua
 * situação e, por compatibilidade com a tela anterior, UM movimento (`bank_movement_id`, o de menor código).
 * Uma transação pode casar com VÁRIOS movimentos ("soma de vários"): a soma, com sinal, tem de ser EXATA.
 */

/** Valor do movimento com sinal, como o extrato o vê: entrada +, saída −; o líquido é `amount + interest`. */
export const VALOR_COM_SINAL = "(case when m.type='in' then m.amount + m.interest else -(m.amount + m.interest) end)";

export const MENSAGEM_TRANSACAO_RESOLVIDA = "Transação já conciliada ou ignorada: desfaça antes";
export const MENSAGEM_CONTA_INVALIDA = "Conta bancária inválida";
/** A 404 com o gênero certo ("Transação não encontrada", "Importação não encontrada"). */
export const naoEncontrada = (oQue: string) => new DomainError("NOT_FOUND", `${oQue} não encontrada`);

/** R$ no texto de uma recusa, sem ponto flutuante: "R$ 1.234,56" / "R$ -10,00". */
export function reais(v: string): string {
  const [inteiro, fracao] = money(v).replace("-", "").split(".");
  const sinal = D(v).isNegative() && !D(v).isZero() ? "-" : "";
  return `R$ ${sinal}${inteiro!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fracao}`;
}

export interface TransacaoOfxLida {
  id: string;
  importId: string;
  contaId: string;
  data: string;
  valor: string;
  memo: string | null;
  situacao: "pending" | "matched" | "ignored";
}

/**
 * A transação pela organização da importação VIVA. Id malformado, inexistente, de outra organização e de importação
 * excluída: a MESMA 404 (testada a forma antes do SQL — uma coluna uuid daria 500 com texto qualquer).
 */
export async function lerTransacao(ctx: ServiceCtx, tid: string, opts: { travar?: boolean } = {}): Promise<TransacaoOfxLida> {
  if (!FORMA_UUID_PADRAO.test(tid)) throw naoEncontrada("Transação");
  const r = await ctx.tx.query<{ id: string; import_id: string; conta_id: string; data: string; valor: string; memo: string | null; situacao: TransacaoOfxLida["situacao"] }>(
    `select t.id, t.import_id, i.bank_account_id as conta_id, to_char(t.posted_date,'YYYY-MM-DD') as data, t.amount::text as valor, t.memo, t.status as situacao
       from erp.ofx_transactions t join erp.ofx_imports i on i.id=t.import_id and i.organization_id=t.organization_id
      where t.id=$1 and t.organization_id=$2 and i.deleted_at is null${opts.travar ? " for update of t" : ""}`, [tid, ctx.orgId]);
  const t = r.rows[0];
  if (!t) throw naoEncontrada("Transação");
  return { id: t.id, importId: t.import_id, contaId: t.conta_id, data: t.data, valor: t.valor, memo: t.memo, situacao: t.situacao };
}

/**
 * Situação da importação recalculada pelas transações: nenhuma pendente → `reconciled`; nenhuma resolvida →
 * `imported`; senão `reconciling`. ROW COUNT 1 (a importação foi lida viva nesta transação).
 */
export async function recalcularImportacao(ctx: ServiceCtx, importId: string): Promise<string> {
  const r = await ctx.tx.query<{ status: string }>(
    `update erp.ofx_imports i set status = case when s.pendentes = 0 then 'reconciled' when s.resolvidas = 0 then 'imported' else 'reconciling' end
       from (select count(*) filter (where status='pending') as pendentes, count(*) filter (where status<>'pending') as resolvidas
               from erp.ofx_transactions where import_id=$1 and organization_id=$2) s
      where i.id=$1 and i.organization_id=$2 and i.deleted_at is null returning i.status`, [importId, ctx.orgId]);
  if (r.rowCount !== 1) throw naoEncontrada("Importação");
  return r.rows[0]!.status;
}

interface Vinculo { tid: string; movimentos: readonly string[] }

/**
 * O NÚCLEO DAS ESCRITAS do vínculo, o MESMO para a confirmação humana e para a conciliação automática da
 * importação: um UPDATE em lote nos movimentos (marca de conciliado, só os confirmados, não conciliados, da conta e
 * sob a RLS), com RETURNING para saber QUAIS vincularam, e um UPDATE em lote nas transações que fecharam por
 * inteiro. Devolve as transações que ficaram `matched`; quem chama decide se uma que não fechou é erro (humano) ou
 * fica pendente (automático). Duas consultas para N vínculos — sem N+1.
 */
async function aplicarVinculos(ctx: ServiceCtx, contaId: string, vinculos: readonly Vinculo[]): Promise<Set<string>> {
  const pares = vinculos.flatMap((v) => v.movimentos.map((m) => ({ tid: v.tid, mid: m })));
  if (!pares.length) return new Set();
  const marcados = await ctx.tx.query<{ id: string; tid: string }>(
    `update erp.bank_movements m set reconciled_at=now(), ofx_transaction_id=x.tid
       from unnest($1::uuid[], $2::uuid[]) as x(mid, tid)
      where m.id=x.mid and m.organization_id=$3 and m.bank_account_id=$4 and m.status='confirmed' and m.reconciled_at is null and m.deleted_at is null
      returning m.id, x.tid`,
    [pares.map((p) => p.mid), pares.map((p) => p.tid), ctx.orgId, contaId]);
  const porTransacao = new Map<string, Set<string>>();
  for (const row of marcados.rows) {
    const s = porTransacao.get(row.tid) ?? new Set<string>();
    s.add(row.id);
    porTransacao.set(row.tid, s);
  }
  const fechadas = vinculos.filter((v) => (porTransacao.get(v.tid)?.size ?? 0) === v.movimentos.length);
  // Uma transação que não fechou por inteiro desfaz a marca dos movimentos que chegou a marcar: um movimento
  // "conciliado" com uma transação pendente seria um saldo conciliado falso.
  const abertas = vinculos.filter((v) => !fechadas.includes(v) && (porTransacao.get(v.tid)?.size ?? 0) > 0);
  if (abertas.length) {
    const soltar = abertas.flatMap((v) => [...(porTransacao.get(v.tid) ?? [])]);
    const r = await ctx.tx.query("update erp.bank_movements set reconciled_at=null, ofx_transaction_id=null where id = any($1::uuid[]) and organization_id=$2", [soltar, ctx.orgId]);
    if (r.rowCount !== soltar.length) throw notFound("Movimento");
  }
  if (!fechadas.length) return new Set();
  // O movimento que a transação guarda (compatibilidade com a tela anterior) é o de MENOR código.
  const principal = await ctx.tx.query<{ tid: string; mid: string }>(
    `select distinct on (m.ofx_transaction_id) m.ofx_transaction_id as tid, m.id as mid from erp.bank_movements m
      where m.organization_id=$1 and m.ofx_transaction_id = any($2::uuid[])
      order by m.ofx_transaction_id, length(m.code), m.code, m.id`, [ctx.orgId, fechadas.map((v) => v.tid)]);
  const casadas = await ctx.tx.query<{ id: string }>(
    `update erp.ofx_transactions t set status='matched', bank_movement_id=x.mid
       from unnest($1::uuid[], $2::uuid[]) as x(tid, mid)
      where t.id=x.tid and t.organization_id=$3 and t.status='pending' returning t.id`,
    [principal.rows.map((p) => p.tid), principal.rows.map((p) => p.mid), ctx.orgId]);
  if (casadas.rowCount !== fechadas.length) throw err("CONFLICT", MENSAGEM_TRANSACAO_RESOLVIDA);
  return new Set(casadas.rows.map((x) => x.id));
}

/**
 * Confirmar (ou vincular à mão) UMA transação a 1..N movimentos. Erros, nesta ordem: transação não encontrada
 * (404); já conciliada ou ignorada (409); movimento repetido no pedido (422); algum movimento que não é da conta,
 * não está confirmado, já está conciliado ou está fora do escopo (a MESMA 404 — lido sob a RLS com `for update`,
 * que também exige a política de UPDATE); soma com sinal diferente do extrato (422). A escrita confere o ROW COUNT.
 */
export async function vincularMovimentos(ctx: ServiceCtx, tid: string, ids: readonly string[]): Promise<{ id: string; situacao: "matched"; movimento_principal: string; movimentos: string[] }> {
  const t = await lerTransacao(ctx, tid, { travar: true });
  if (t.situacao !== "pending") throw err("CONFLICT", MENSAGEM_TRANSACAO_RESOLVIDA);
  const pedidos = ids.map((x) => x.toLowerCase());
  if (new Set(pedidos).size !== pedidos.length) throw validation("Movimento repetido na lista", [{ path: ["movimento_ids"], message: "Movimento repetido na lista" }]);
  const movs = await ctx.tx.query<{ id: string; code: string; valor: string }>(
    `select m.id, m.code, ${VALOR_COM_SINAL}::text as valor from erp.bank_movements m
      where m.id = any($1::uuid[]) and m.organization_id=$2 and m.bank_account_id=$3 and m.status='confirmed' and m.reconciled_at is null and m.deleted_at is null
      order by length(m.code), m.code, m.id for update`, [pedidos, ctx.orgId, t.contaId]);
  if (movs.rowCount !== pedidos.length) throw notFound("Movimento");
  const soma = money(sum(movs.rows.map((m) => m.valor)));
  if (!D(soma).eq(t.valor)) {
    throw validation(`A soma dos movimentos (${reais(soma)}) difere do valor do extrato (${reais(t.valor)})`, { soma, valor: money(t.valor) });
  }
  const casadas = await aplicarVinculos(ctx, t.contaId, [{ tid: t.id, movimentos: pedidos }]);
  if (!casadas.has(t.id)) throw notFound("Movimento");
  await recalcularImportacao(ctx, t.importId);
  await audit(ctx.tx, ctx, "ofx_transactions", t.id, "reconcile", { movimentos: pedidos, automatico: false });
  return { id: t.id, situacao: "matched", movimento_principal: movs.rows[0]!.id, movimentos: movs.rows.map((m) => m.id) };
}

/** Ignorar uma transação pendente (tarifa já lançada por outro caminho, linha informativa do banco…). */
export async function ignorarTransacao(ctx: ServiceCtx, tid: string, motivo: string | null): Promise<{ id: string; situacao: "ignored" }> {
  const t = await lerTransacao(ctx, tid, { travar: true });
  if (t.situacao !== "pending") throw err("CONFLICT", MENSAGEM_TRANSACAO_RESOLVIDA);
  const r = await ctx.tx.query("update erp.ofx_transactions set status='ignored' where id=$1 and organization_id=$2 and status='pending'", [t.id, ctx.orgId]);
  if (r.rowCount !== 1) throw err("CONFLICT", MENSAGEM_TRANSACAO_RESOLVIDA);
  await recalcularImportacao(ctx, t.importId);
  await audit(ctx.tx, ctx, "ofx_transactions", t.id, "ignore", { motivo });
  return { id: t.id, situacao: "ignored" };
}

/**
 * Desfazer: `matched` → os movimentos voltam a livres e a transação a `pending`; `ignored` → `pending`; `pending` →
 * 409 "Nada a desfazer". Os movimentos são lidos sob a RLS (com `for update`, que exige também a política de UPDATE):
 * se o que se enxerga não fecha com o valor do extrato, há vínculo FORA do escopo de quem pede, e desfazer só a parte
 * visível deixaria movimento "conciliado" com uma transação pendente — recusa (409), sem tocar em nada.
 */
export async function desfazerConciliacao(ctx: ServiceCtx, tid: string, motivo: string): Promise<{ id: string; situacao: "pending"; movimentos_liberados: string[] }> {
  const t = await lerTransacao(ctx, tid, { travar: true });
  if (t.situacao === "pending") throw err("CONFLICT", "Nada a desfazer");
  let liberados: string[] = [];
  if (t.situacao === "matched") {
    const movs = await ctx.tx.query<{ id: string; valor: string }>(
      `select m.id, ${VALOR_COM_SINAL}::text as valor from erp.bank_movements m where m.organization_id=$1 and m.ofx_transaction_id=$2 order by m.id for update`, [ctx.orgId, t.id]);
    if (!D(money(sum(movs.rows.map((m) => m.valor)))).eq(t.valor)) {
      throw err("CONFLICT", "Esta conciliação tem movimento que você não pode alterar: peça a quem enxerga todas as empresas dela para desfazer");
    }
    liberados = movs.rows.map((m) => m.id);
    const r = await ctx.tx.query("update erp.bank_movements set reconciled_at=null, ofx_transaction_id=null where organization_id=$1 and ofx_transaction_id=$2", [ctx.orgId, t.id]);
    if (r.rowCount !== liberados.length) throw notFound("Movimento");
  }
  const r = await ctx.tx.query("update erp.ofx_transactions set status='pending', bank_movement_id=null where id=$1 and organization_id=$2 and status=$3", [t.id, ctx.orgId, t.situacao]);
  if (r.rowCount !== 1) throw err("CONFLICT", "Nada a desfazer");
  await recalcularImportacao(ctx, t.importId);
  await audit(ctx.tx, ctx, "ofx_transactions", t.id, "unreconcile", { motivo, situacao_anterior: t.situacao, movimentos: liberados });
  return { id: t.id, situacao: "pending", movimentos_liberados: liberados };
}

export interface ResultadoImportacao {
  id: string;
  codigo: string;
  transacoes: number;
  duplicadas: number;
  recusadas: { fitid: string | null; motivo: string }[];
  conciliadas_automaticamente: number;
}

/**
 * Importar um extrato OFX numa conta da organização. Ordem das recusas (422): conta inexistente, de outra
 * organização, excluída ou inativa → "Conta bancária inválida" (a mesma para todas); arquivo de OUTRA conta (o
 * ACCTID não confere com o número cadastrado); nenhuma transação válida; todas já importadas nesta conta. Linha
 * ilegível do arquivo não derruba a importação: vai para `recusadas` com o motivo. FITID já importado nesta conta
 * (em qualquer importação viva) não entra de novo (`duplicadas`). A conciliação automática é SÓ do "Encontrado"
 * único (mesmo valor e mesma data, 1:1) e passa pelo MESMO núcleo de escrita da confirmação humana.
 */
export async function importarOfx(ctx: ServiceCtx, d: { contaId: string; descricao: string; conteudo: string }): Promise<ResultadoImportacao> {
  // `for no key update` serializa as importações da MESMA conta: a conferência de FITID já importado abaixo não tem
  // índice único entre importações, e duas importações simultâneas do mesmo arquivo passariam as duas.
  const conta = await ctx.tx.query<{ id: string; account_number: string | null }>(
    "select id, account_number from erp.bank_accounts where id=$1 and organization_id=$2 and deleted_at is null and is_active for no key update", [d.contaId, ctx.orgId]);
  if (!conta.rows[0]) throw validation(MENSAGEM_CONTA_INVALIDA, [{ path: ["conta_id"], message: MENSAGEM_CONTA_INVALIDA }]);
  const contaId = conta.rows[0].id;
  const leitura = lerOfx(d.conteudo);
  if (contaDoOfxConfere(leitura.conta, conta.rows[0].account_number) === false) {
    throw validation(`O arquivo OFX é de outra conta (conta do arquivo: ${leitura.conta.conta ?? ""}).`, { contaDoArquivo: leitura.conta.conta });
  }
  if (!leitura.transacoes.length) throw validation("Nenhuma transação válida no arquivo OFX", { recusadas: leitura.recusadas });

  const jaImportadas = await ctx.tx.query<{ fitid: string }>(
    `select distinct t.fitid from erp.ofx_transactions t join erp.ofx_imports i on i.id=t.import_id and i.organization_id=t.organization_id
      where i.organization_id=$1 and i.bank_account_id=$2 and i.deleted_at is null and t.fitid = any($3::text[])`,
    [ctx.orgId, contaId, leitura.transacoes.map((t) => t.fitid)]);
  const repetidos = new Set(jaImportadas.rows.map((x) => x.fitid));
  const novas = leitura.transacoes.filter((t) => !repetidos.has(t.fitid));
  if (!novas.length) throw validation("Todas as transações do arquivo já foram importadas nesta conta", { duplicadas: repetidos.size });

  const datas = novas.map((t) => t.data).sort();
  const de = datas[0]!;
  const ate = datas[datas.length - 1]!;
  const codigo = await nextCode(ctx.tx, ctx.orgId, "ofx_import");
  const imp = await ctx.tx.query<{ id: string }>(
    "insert into erp.ofx_imports(organization_id,code,description,bank_account_id,start_date,end_date,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [ctx.orgId, codigo, d.descricao, contaId, de, ate, ctx.user.id]);
  const importId = imp.rows[0]!.id;
  await atribuirIdGlobal(ctx, "ofx_imports", importId);
  const inseridas = await ctx.tx.query<{ id: string; fitid: string }>(
    `insert into erp.ofx_transactions(import_id,organization_id,fitid,posted_date,amount,memo,check_number,status)
     select $1, $2, x.fitid, x.data::date, x.valor::numeric, x.memo, x.cheque, 'pending'
       from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) as x(fitid, data, valor, memo, cheque)
     returning id, fitid`,
    [importId, ctx.orgId, novas.map((t) => t.fitid), novas.map((t) => t.data), novas.map((t) => t.valor), novas.map((t) => t.memo), novas.map((t) => t.numeroCheque)]);
  if (inseridas.rowCount !== novas.length) throw err("CONFLICT", "Transações do extrato não gravadas");
  const idDoFitid = new Map(inseridas.rows.map((x) => [x.fitid, x.id]));

  // Candidatos ao "Encontrado": só a data exata importa, então a janela é [de, ate]. `for update` trava os
  // candidatos (sob a RLS e a política de UPDATE): uma conciliação concorrente da mesma conta espera esta terminar.
  const candidatos = await ctx.tx.query<{ id: string; data: string; valor: string }>(
    `select m.id, to_char(m.movement_date,'YYYY-MM-DD') as data, ${VALOR_COM_SINAL}::text as valor from erp.bank_movements m
      where m.organization_id=$1 and m.bank_account_id=$2 and m.status='confirmed' and m.reconciled_at is null and m.deleted_at is null
        and m.movement_date between $3::date and $4::date
      order by m.id for update`, [ctx.orgId, contaId, de, ate]);
  const sugestoes = sugerirConciliacao(novas.map((t) => ({ id: idDoFitid.get(t.fitid)!, data: t.data, valor: t.valor })), candidatos.rows);
  const encontradas = sugestoes.filter((s) => s.tipo === "encontrado").map((s) => ({ tid: s.transacaoId, movimentos: s.grupos[0]! }));
  const casadas = await aplicarVinculos(ctx, contaId, encontradas);
  await recalcularImportacao(ctx, importId);
  const recusadas = leitura.recusadas;
  await audit(ctx.tx, ctx, "ofx_imports", importId, "create", { transacoes: novas.length, duplicadas: repetidos.size, recusadas: recusadas.length, conciliadas_automaticamente: casadas.size });
  return { id: importId, codigo, transacoes: novas.length, duplicadas: repetidos.size, recusadas, conciliadas_automaticamente: casadas.size };
}
