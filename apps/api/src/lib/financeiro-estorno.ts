import { D } from "@agro/shared";
import type { ServiceCtx } from "./context.js";
import { exigirEmpresaVisivel } from "./context.js";
import { assertPeriodOpen, audit, requirePermission } from "./service.js";
import { err, notFound } from "./errors.js";

const permOf = (dir: string, action: string) => `${dir === "payable" ? "payables" : "receivables"}.${action}`;

/** Adiantamento é `payment_type='advance'` OU o tipo de título marcado `is_advance` (decisão 285: o defeito "is_advance não é lido"). */
export const EH_ADIANTAMENTO_SQL = (alias: string) =>
  `(${alias}.payment_type='advance' or exists (select 1 from erp.title_types tta where tta.id=${alias}.title_type_id and tta.is_advance))`;

export const MENSAGEM_MOVIMENTO_COMPARTILHADO = "Movimento bancário compartilhado com outras baixas: cancele todas ou lance ajuste";
export const MENSAGEM_MOVIMENTO_CONCILIADO = "Movimento conciliado: desfaça a conciliação antes";
export const MENSAGEM_CREDITO_USADO = "O crédito gerado por esta baixa já foi usado: estorne a compensação antes";
export const MENSAGEM_ADIANTAMENTO_USADO = "Adiantamento com crédito usado: estorne as compensações antes";

/**
 * ESTORNO DE UMA BAIXA (OPERACOES-01 F8, decisão 285) — o corpo da rota `POST {base}/:id/settlements/:sid/cancel`
 * MOVIDO para cá, com as mensagens, a ordem e os comentários de antes, para servir também ao estorno em lote
 * (`/financeiro/titulos/estornar-baixas`) e ao estorno do lote inteiro (`/financeiro/lotes-baixa/:loteId/estorno`).
 *
 * O que entrou, TUDO antes do primeiro UPDATE:
 *   1. os movimentos a cancelar são o principal e os COMPONENTES lançados em separado (juros, multa, acréscimo,
 *      tarifa); algum conciliado com o extrato → 409 (desfazer a conciliação primeiro);
 *   2. o principal compartilhado com outra baixa confirmada continua 409 — a não ser que esteja em
 *      `movimentosLiberados`: aí o CHAMADOR provou que todas as baixas daquele movimento saem juntas e o cancela
 *      uma vez, no fim;
 *   3. a baixa que gerou CRÉDITO (excedente): crédito já usado → 409; senão o crédito (a baixa dele e o título-
 *      adiantamento) cai junto — o movimento é o mesmo;
 *   4. o título é um ADIANTAMENTO cujo crédito já foi usado → 409.
 * E depois: os movimentos são cancelados com a trilha (motivo, quando, quem) e ROW COUNT; o título do "gera
 * obrigação" cai junto com o seu movimento; a tarifa do lote cai quando sai a última baixa do lote.
 */
export async function estornarBaixa(ctx: ServiceCtx, p: { tituloId: string; baixaId: string; direcao: "payable" | "receivable"; motivo: string; movimentosLiberados?: ReadonlySet<string> }): Promise<{ movimentosCancelados: string[] }> {
  const { tituloId: id, baixaId: sid, direcao: dir } = p;
  const d = { reason: p.motivo };
  // FRONTEIRA DE VARIANTE: o TÍTULO é provado ANTES de olhar a baixa. Descobrir a direction depois
  // seria descobrir depois de já ter lido a baixa — e a ordem antiga chegava a `for update` numa linha
  // que esta rota não tinha o direito de tocar. Variante errada devolve a MESMA 404 de baixa
  // inexistente: não revela que o título existe na variante vizinha.
  // A MENSAGEM TAMBÉM É SUPERFÍCIE DE RECUSA. Todas as recusas desta rota dizem "Baixa não encontrado":
  // título inexistente, de outro tenant, excluído, de variante errada E fora do escopo de empresa. Com
  // rótulos diferentes ("Baixa" aqui, "Título" logo abaixo) o 404 de FORA DE ESCOPO se distinguiria do
  // 404 de INEXISTENTE — e distinguir é confirmar que aquele UUID é um título desta variante neste
  // tenant. Mesmo status, mesma mensagem, ou a 404 vira oráculo de existência.
  const t = await ctx.tx.query<{ empresa_id: string; source_type: string | null; source_id: string | null; eh_adiantamento: boolean }>(
    `select t.empresa_id, t.source_type, t.source_id::text as source_id, ${EH_ADIANTAMENTO_SQL("t")} as eh_adiantamento from erp.financial_titles t where t.id=$1 and t.organization_id=$2 and t.direction=$3 and t.deleted_at is null`,
    [id, ctx.orgId, dir]);
  if (!t.rows[0]) throw notFound("Baixa");
  await exigirEmpresaVisivel(ctx, t.rows[0].empresa_id, "Baixa");
  const s = await ctx.tx.query<{ status: string; bank_movement_id: string | null; settlement_date: string; cross_title_id: string | null; amount: string; lote_id: string | null }>("select status, bank_movement_id::text as bank_movement_id, settlement_date, cross_title_id, amount, lote_id::text as lote_id from erp.title_settlements where id=$1 and title_id=$2 and organization_id=$3 for update", [sid, id, ctx.orgId]);
  if (!s.rows[0]) throw notFound("Baixa"); if (s.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Baixa já cancelada");
  await assertPeriodOpen(ctx.tx, ctx.orgId, t.rows[0].empresa_id, s.rows[0].settlement_date);
  /**
   * CANCELAR UMA BAIXA CRUZADA É DUAS MUTAÇÕES, E A AUTORIZAÇÃO COMPOSTA FECHA ANTES DA PRIMEIRA.
   *
   * Quando a baixa tem `cross_title_id`, este cancelamento também cancela a linha ESPELHO, que vive
   * no título da variante contrária. Só `{variant}.cancel_settlement` da rota não autoriza isso.
   * Tudo é resolvido ANTES do primeiro UPDATE: deixar a mutação principal acontecer e só depois
   * descobrir que falta permissão do outro lado é descobrir tarde demais — mesmo com rollback, o
   * CÓDIGO DE ERRO que sai já teria contado o que não devia.
   *
   * IDENTIDADE DO ESPELHO — LOCALIZAR NÃO É PROVAR, ENTÃO A CARDINALIDADE É QUE DECIDE.
   *
   * `erp.title_settlements` NÃO tem constraint que torne o espelho único (0004_financial.sql: só
   * índices em title_id e em (organization_id, settlement_date)). Não existe, nesta versão, nenhuma
   * garantia de BANCO ligando as duas linhas de uma baixa cruzada. Logo a garantia tem de ser da
   * APLICAÇÃO — e uma garantia de aplicação que aceita "achei alguma coisa" não é garantia.
   *
   * Os discriminadores abaixo LOCALIZAM o candidato; quem decide é `rowCount === 1`. O corte anterior
   * fazia `rows[0]?.id ?? null` e falhava ABERTO nas duas pontas: com ZERO candidatos seguia adiante,
   * cancelava o principal e deixava o par pela metade, sem erro nenhum; com MAIS DE UM escolhia
   * arbitrariamente o primeiro e chamava isso de identidade. Zero ou vários agora abortam ANTES do
   * primeiro UPDATE — nada do principal, nada do espelho, nada do movimento bancário, nada de trilha.
   *
   * QUAIS discriminadores, e por que só estes: são os campos que as DUAS linhas recebem do MESMO
   * valor no momento da criação (ver `settle`) — `organization_id`, o par cruzado de
   * (`title_id`, `cross_title_id`) invertido, `settlement_kind`, `settlement_date`, o VALOR
   * COMPENSADO, `created_by` e `created_at` (= `now()`, o início da TRANSAÇÃO que gravou as duas).
   * O valor compensado é `amount − discount` dos dois lados (semântica B, decisão 285: o principal
   * baixa `amount` com o desconto dentro e o espelho abate `amount − desconto`, sem desconto); o par
   * gravado ANTES da semântica B (espelho com o mesmo `amount` do principal) continua casando pela
   * igualdade de `amount`, que é a comparação de antes. Ficam de fora, de propósito, os campos que
   * comprovadamente DIVERGEM entre os lados: `net_amount` (o principal soma juros/multa), `note` (o
   * espelho tem texto próprio quando o pedido não traz nota) e os acréscimos, que no espelho ficam
   * em zero. Filtrar por um campo que diverge transformaria toda baixa cruzada com juros em "zero
   * candidatos".
   *
   * A comparação fica DENTRO do SQL. Trafegar `created_at` por JavaScript perderia precisão:
   * `timestamptz` tem microssegundos e o `Date` do driver só tem milissegundos, então o valor
   * voltaria truncado e nunca casaria — o primeiro corte deste hotfix fazia esse round-trip e
   * silenciosamente não achava espelho nenhum. O mesmo vale para `amount`: comparar `numeric` no
   * banco evita qualquer normalização de string no meio do caminho.
   */
  let espelhoId: string | null = null;
  if (s.rows[0].cross_title_id) {
    const contraria = dir === "payable" ? "receivable" : "payable";
    requirePermission(ctx, permOf(contraria, "cancel_settlement"));
    const ct = await ctx.tx.query<{ empresa_id: string }>("select empresa_id from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null", [s.rows[0].cross_title_id, ctx.orgId, contraria]);
    if (!ct.rows[0]) throw notFound("Baixa");
    await exigirEmpresaVisivel(ctx, ct.rows[0].empresa_id, "Baixa");
    await assertPeriodOpen(ctx.tx, ctx.orgId, ct.rows[0].empresa_id, s.rows[0].settlement_date);
    const e = await ctx.tx.query<{ id: string }>(
      "select e.id from erp.title_settlements e"
      + " where e.organization_id=$1 and e.title_id=$2 and e.cross_title_id=$3 and e.status='confirmed' and e.id<>$4"
      + " and exists (select 1 from erp.title_settlements p where p.id=$4 and p.organization_id=$1"
      + " and e.created_at=p.created_at and e.settlement_kind=p.settlement_kind"
      + " and e.settlement_date=p.settlement_date and (e.amount - e.discount = p.amount - p.discount or e.amount=p.amount)"
      + " and e.created_by is not distinct from p.created_by)"
      + " for update",
      [ctx.orgId, s.rows[0].cross_title_id, id, sid]);
    // Zero e "mais de um" são o MESMO defeito visto de dois lados: em nenhum dos dois o par está
    // provado, e cancelar sem o par provado é escrever um estado que ninguém consegue reconstituir.
    if (e.rowCount !== 1) throw err("CONFLICT", "Par da baixa cruzada não identificado com exatidão: cancelamento bloqueado");
    espelhoId = e.rows[0]!.id;
  }

  // ---- (F8) tudo o que pode recusar, ANTES do primeiro UPDATE ----
  const principal = s.rows[0].bank_movement_id;
  const liberado = principal !== null && Boolean(p.movimentosLiberados?.has(principal.toLowerCase()));
  // 1) os movimentos da baixa: o principal e os componentes lançados em separado. Conciliado não se estorna.
  const movs = await ctx.tx.query<{ id: string; status: string; conciliado: boolean; componente: boolean }>(
    "select m.id::text as id, m.status, m.reconciled_at is not null as conciliado, m.title_settlement_id is not null as componente from erp.bank_movements m"
    + " where m.organization_id=$1 and (m.id=$2::uuid or (m.title_settlement_id=$3 and m.status='confirmed'))",
    [ctx.orgId, principal, sid]);
  const confirmados = movs.rows.filter((m) => m.status === "confirmed");
  // O principal fora do recorte da RLS (movimento sem empresa, para quem não tem escopo total) não pode ficar
  // confirmado em silêncio com a baixa estornada: recusa antes de qualquer gravação.
  if (principal && !movs.rows.some((m) => m.id.toLowerCase() === principal.toLowerCase())) throw err("CONFLICT", "Movimento bancário da baixa não pôde ser estornado");
  if (confirmados.some((m) => m.conciliado)) throw err("CONFLICT", MENSAGEM_MOVIMENTO_CONCILIADO);
  // 3) o CRÉDITO que esta baixa gerou (excedente): o título-adiantamento nasceu baixado pelo MESMO movimento.
  const credito = await ctx.tx.query<{ id: string; usado: string }>(
    "select c.id::text as id, (select coalesce(sum(u.amount),0) from erp.title_settlements u where u.adiantamento_id=c.id and u.status='confirmed')::text as usado"
    + " from erp.financial_titles c where c.organization_id=$1 and c.source_type='title_settlements' and c.source_id=$2 and c.status<>'cancelled' and c.deleted_at is null",
    [ctx.orgId, sid]);
  const creditos = credito.rows.map((c) => c.id);
  // 2) o principal compartilhado com OUTRA baixa confirmada (a do crédito acima não conta: ela cai junto).
  if (principal && !liberado) {
    const shared = await ctx.tx.query<{ n: string }>(
      "select count(*) n from erp.title_settlements where bank_movement_id=$1 and status='confirmed' and id<>$2 and not (title_id = any($3::uuid[]))",
      [principal, sid, creditos]);
    if (Number(shared.rows[0]!.n) > 0) throw err("CONFLICT", MENSAGEM_MOVIMENTO_COMPARTILHADO);
  }
  if (credito.rows.some((c) => D(c.usado).gt(0))) throw err("CONFLICT", MENSAGEM_CREDITO_USADO);
  // 4) o título é um adiantamento cujo crédito já foi usado: estornar a baixa dele tiraria o lastro das compensações.
  if (t.rows[0].eh_adiantamento) {
    const usos = await ctx.tx.query<{ n: string }>("select count(*) n from erp.title_settlements where adiantamento_id=$1 and status='confirmed'", [id]);
    if (Number(usos.rows[0]!.n) > 0) throw err("CONFLICT", MENSAGEM_ADIANTAMENTO_USADO);
  }

  const cb = await ctx.tx.query("update erp.title_settlements set status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 where id=$1 and organization_id=$4 and status='confirmed'", [sid, ctx.user.id, d.reason, ctx.orgId]);
  if (cb.rowCount !== 1) throw err("CONFLICT", "Baixa não pôde ser estornada");
  // Os movimentos da baixa caem juntos, com a trilha do estorno. ROW COUNT: sob a RLS um movimento fora do recorte
  // responderia zero linhas — e um estorno "feito" com o dinheiro ainda no extrato é o pior silêncio possível.
  const aCancelar = confirmados.filter((m) => !(liberado && m.id.toLowerCase() === principal!.toLowerCase())).map((m) => m.id);
  if (aCancelar.length) {
    const r = await ctx.tx.query("update erp.bank_movements set status='cancelled', cancel_reason=$3, cancelled_at=now(), cancelled_by=$4, updated_at=now() where id = any($1::uuid[]) and organization_id=$2 and status='confirmed'", [aCancelar, ctx.orgId, d.reason, ctx.user.id]);
    if (r.rowCount !== aCancelar.length) throw err("CONFLICT", "Movimento bancário da baixa não pôde ser estornado");
    for (const m of aCancelar) await audit(ctx.tx, ctx, "bank_movements", m, "cancel", { reason: d.reason, baixa: sid });
  }
  // 3, depois) o crédito do excedente: a baixa dele e o título-adiantamento, nessa ordem (o gatilho do ledger não
  // recalcula título cancelado, então a baixa sai primeiro e o título fica zerado antes de cancelar).
  if (creditos.length) {
    const b = await ctx.tx.query<{ id: string }>("update erp.title_settlements set status='cancelled', cancelled_at=now(), cancelled_by=$3, cancel_reason=$4 where title_id = any($1::uuid[]) and organization_id=$2 and status='confirmed' returning id", [creditos, ctx.orgId, ctx.user.id, d.reason]);
    for (const x of b.rows) await audit(ctx.tx, ctx, "title_settlements", x.id, "cancel", { ...d, credito_da_baixa: sid });
    const c = await ctx.tx.query("update erp.financial_titles set status='cancelled', cancel_reason=$3, cancelled_at=now(), cancelled_by=$4, version=version+1 where id = any($1::uuid[]) and organization_id=$2 and status<>'cancelled'", [creditos, ctx.orgId, d.reason, ctx.user.id]);
    if (c.rowCount !== creditos.length) throw err("CONFLICT", "Crédito da baixa não pôde ser estornado");
    for (const x of creditos) await audit(ctx.tx, ctx, "financial_titles", x, "cancel", { ...d, credito_da_baixa: sid });
  }
  // O título do "gera obrigação" nasceu do movimento e é baixado por ele: sem o movimento, ele não tem origem.
  if (principal && t.rows[0].source_type === "bank_movements" && (t.rows[0].source_id ?? "").toLowerCase() === principal.toLowerCase()) {
    const g = await ctx.tx.query("update erp.financial_titles set status='cancelled', cancel_reason=$3, cancelled_at=now(), cancelled_by=$4, version=version+1 where id=$1 and organization_id=$2 and status<>'cancelled' and not exists (select 1 from erp.title_settlements x where x.title_id=$1 and x.status='confirmed')", [id, ctx.orgId, d.reason, ctx.user.id]);
    if (g.rowCount === 1) await audit(ctx.tx, ctx, "financial_titles", id, "cancel", { ...d, origem: "movimento_estornado" });
  }
  // A tarifa do LOTE sai com a última baixa do lote.
  const tarifaDoLote: string[] = [];
  if (s.rows[0].lote_id) {
    const resta = await ctx.tx.query<{ n: string }>("select count(*) n from erp.title_settlements where organization_id=$1 and lote_id=$2 and status='confirmed'", [ctx.orgId, s.rows[0].lote_id]);
    if (Number(resta.rows[0]!.n) === 0) {
      const tarifas = await ctx.tx.query<{ id: string }>("select id::text as id from erp.bank_movements where organization_id=$1 and lote_baixa_id=$2 and componente_baixa='tarifa' and status='confirmed'", [ctx.orgId, s.rows[0].lote_id]);
      if (tarifas.rows.length) {
        const ids = tarifas.rows.map((x) => x.id);
        const r = await ctx.tx.query("update erp.bank_movements set status='cancelled', cancel_reason=$3, cancelled_at=now(), cancelled_by=$4, updated_at=now() where id = any($1::uuid[]) and organization_id=$2 and status='confirmed'", [ids, ctx.orgId, d.reason, ctx.user.id]);
        if (r.rowCount !== ids.length) throw err("CONFLICT", "Tarifa do lote não pôde ser estornada");
        for (const m of ids) await audit(ctx.tx, ctx, "bank_movements", m, "cancel", { reason: d.reason, lote: s.rows[0].lote_id });
        tarifaDoLote.push(...ids);
      }
    }
  }
  if (espelhoId) {
    const r = await ctx.tx.query("update erp.title_settlements set status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 where id=$1", [espelhoId, ctx.user.id, d.reason]);
    if (r.rowCount !== 1) throw err("CONFLICT", "Baixa espelho não pôde ser cancelada");
    await audit(ctx.tx, ctx, "title_settlements", espelhoId, "cancel", { ...d, title: s.rows[0].cross_title_id, cruzada_com: id, lado: "par" });
  }
  /**
   * SIMETRIA DA TRILHA — E POR QUE O CANCELAMENTO NÃO USA OS RÓTULOS DA CRIAÇÃO.
   *
   * O espelho carregava `cruzada_com` e o principal não, então reconstruir o par a partir de
   * `audit_logs` só funcionava a partir de UM dos lados; pelo outro exigia voltar à linha de
   * `title_settlements`, que pode ter mudado de status desde então. Agora os DOIS se nomeiam, e
   * `title` + `cruzada_com` bastam para reconstituir o par em qualquer caminho.
   *
   * `lado` no cancelamento vale "alvo" e "par", NÃO "principal" e "espelho", e a diferença é de
   * verdade, não de gosto. A linha espelho também tem `cross_title_id`, então ela é cancelável pela
   * PRÓPRIA rota: nesse caminho quem chega como alvo é o espelho, e o principal original é que vem
   * como o outro lado. Nada na linha distingue quem foi principal na criação — o espelho não guarda
   * conta bancária, movimento, acréscimos nem nada que sirva de marca, e as duas nascem no mesmo
   * `created_at`. Carimbar "principal" no alvo faria o campo dizer, na metade dos caminhos, o
   * contrário do que a criação registrou: o MESMO id apareceria como `lado: "principal"` no `create`
   * e `lado: "espelho"` no `cancel`. Papel de criação é irrecuperável aqui; papel NESTA operação é
   * observável. O campo diz o que é observável.
   */
  await audit(ctx.tx, ctx, "title_settlements", sid, "cancel", espelhoId ? { ...d, title: id, cruzada_com: s.rows[0].cross_title_id, lado: "alvo" } : d);
  return { movimentosCancelados: [...aCancelar, ...tarifaDoLote] };
}
