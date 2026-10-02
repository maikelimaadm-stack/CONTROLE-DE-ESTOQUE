import type { FastifyInstance } from "fastify";
import { z } from "zod";
import ExcelJS from "exceljs";
import { D, isISODate, money, sum } from "@agro/shared";
import { CAPACIDADE_CENTRAL_FINANCEIRA, FORMA_UUID_PADRAO } from "@agro/domain";
import { runService, idempotent, audit, requirePermission, comPermissaoResolvida } from "../lib/service.js";
import { hasPermission, empresaScopeSql, exigirEmpresaVisivel, type ServiceCtx } from "../lib/context.js";
import { denied, err, notFound, validation } from "../lib/errors.js";
import {
  consultaDeTitulosSchema, exportacaoDeTitulosSchema, listarTitulosDaCentral, linhasDaExportacao, csvDaExportacao, COLUNAS_DA_EXPORTACAO, DIRECOES, type Direcao
} from "../lib/financeiro-titulos-consulta.js";
import { estornarBaixa, EH_ADIANTAMENTO_SQL } from "../lib/financeiro-estorno.js";
import { periodoAbertoNoLote } from "../lib/financeiro-baixa.js";

/**
 * CENTRAL FINANCEIRA — TÍTULOS (OPERACOES-01 F8, decisão 285). Prefixo PRÓPRIO (`/api/financeiro/*`): a API anterior
 * responde 404 de rota, e esse 404 é a ausência da capacidade — a web nova cai na tela de hoje (skew sentido 1).
 *
 * Portas DINÂMICAS: a direção do título decide a capacidade (`payables.*` × `receivables.*`). A porta exige ao menos
 * uma das duas (403 sem nenhuma), publica o módulo financeiro (`comPermissaoResolvida`) e só então lê — com o
 * escopo de empresa no SQL. A capacidade da direção de cada registro é conferida ANTES de qualquer efeito.
 * Id malformado no caminho = a MESMA 404 do inexistente (a forma é testada antes do SQL).
 */
const permOf = (dir: Direcao, acao: string) => `${dir === "payable" ? "payables" : "receivables"}.${acao}`;
const idem = (req: { headers: Record<string, unknown> }) => req.headers["idempotency-key"] as string | undefined;
const uuid = z.string().uuid();
const MOTIVO = z.string().trim().min(1).max(500);
const idsDoPedido = z.array(uuid).min(1).max(200).refine((xs) => new Set(xs.map((x) => x.toLowerCase())).size === xs.length, "Título repetido no pedido");

/** A porta: direções em que o usuário tem `acao`; nenhuma → 403. Devolve o contexto com o módulo financeiro publicado. */
async function porta(ctx: ServiceCtx, acao: string): Promise<{ ctx: ServiceCtx; dirs: Direcao[] }> {
  const dirs = DIRECOES.filter((d) => hasPermission(ctx, permOf(d, acao)));
  if (!dirs.length) throw denied(permOf("payable", acao));
  return { ctx: await comPermissaoResolvida(ctx, permOf(dirs[0]!, acao)), dirs };
}
/** Direções pedidas pela query, recortadas pelas que a porta autorizou (pedido explícito sem capacidade → 403). */
function direcoesPedidas(direcao: "payable" | "receivable" | "todos", autorizadas: readonly Direcao[], acao: string): Direcao[] {
  if (direcao === "todos") return [...autorizadas];
  if (!autorizadas.includes(direcao)) throw denied(permOf(direcao, acao));
  return [direcao];
}

/**
 * Lote de baixa visto pela porta: TODAS as baixas com o `lote_id` precisam de título visível (escopo de empresa e
 * RLS) — uma invisível torna o lote inteiro inexistente para quem pede (404), sem revelar quantas há.
 */
async function carregarLote(ctx: ServiceCtx, loteId: string, acao: string) {
  if (!FORMA_UUID_PADRAO.test(loteId)) throw notFound("Lote");
  const total = await ctx.tx.query<{ n: string }>("select count(*)::text as n from erp.title_settlements where organization_id=$1 and lote_id=$2", [ctx.orgId, loteId]);
  const params: unknown[] = [ctx.orgId, loteId];
  const baixas = await ctx.tx.query<{ id: string; titulo_id: string; status: string; amount: string; net_amount: string; settlement_date: string; bank_account_id: string | null; bank_movement_id: string | null; tarifa: string | null; direction: Direcao; codigo: string; numero: string; empresa_id: string; empresa_nome: string; pessoa_nome: string | null; conta_descricao: string | null }>(
    "select s.id::text as id, s.title_id::text as titulo_id, s.status, s.amount::text as amount, s.net_amount::text as net_amount, s.settlement_date, s.bank_account_id::text as bank_account_id,"
    + " s.bank_movement_id::text as bank_movement_id, s.tarifa::text as tarifa, t.direction, t.code as codigo, t.number as numero, t.empresa_id::text as empresa_id, e.name as empresa_nome, p.name as pessoa_nome, ba.description as conta_descricao"
    + " from erp.title_settlements s join erp.financial_titles t on t.id=s.title_id join erp.empresas e on e.id=t.empresa_id left join erp.people p on p.id=t.person_id left join erp.bank_accounts ba on ba.id=s.bank_account_id"
    + " where s.organization_id=$1 and s.lote_id=$2 and t.deleted_at is null" + empresaScopeSql(ctx, "t", params, { ignoreSelected: true }) + " order by s.created_at, s.id", params);
  if (!baixas.rows.length || baixas.rows.length !== Number(total.rows[0]!.n)) throw notFound("Lote");
  const direcoes = [...new Set(baixas.rows.map((b) => b.direction))];
  // A direção do lote decide a capacidade; faltando, a MESMA 404 (como a fronteira de variante das rotas antigas).
  if (direcoes.length !== 1 || !hasPermission(ctx, permOf(direcoes[0]!, acao))) throw notFound("Lote");
  for (const e of new Set(baixas.rows.map((b) => b.empresa_id))) await exigirEmpresaVisivel(ctx, e, "Lote");
  return { direcao: direcoes[0]!, baixas: baixas.rows };
}

/**
 * Plano de estorno de um conjunto S de baixas confirmadas: cada movimento PRINCIPAL compartilhado por 2+ baixas de S
 * cujas baixas confirmadas estão TODAS em S é LIBERADO (cancelado uma vez, no fim, por quem chama); um movimento
 * com baixa confirmada FORA de S (fora o crédito do excedente gerado por uma baixa de S, que cai junto) torna as
 * baixas dele não estornáveis aqui. A contagem é na tabela de baixas (sem junção com títulos), para a RLS de
 * empresa de um título vizinho não esconder a baixa que prende o movimento.
 */
async function planejarEstorno(ctx: ServiceCtx, baixas: readonly { id: string; bank_movement_id: string | null }[]) {
  const ids = baixas.map((b) => b.id.toLowerCase());
  const movs = [...new Set(baixas.flatMap((b) => (b.bank_movement_id ? [b.bank_movement_id.toLowerCase()] : [])))];
  if (!movs.length) return { liberados: new Set<string>(), presos: new Set<string>() };
  const creditos = await ctx.tx.query<{ id: string }>("select id::text as id from erp.financial_titles where organization_id=$1 and source_type='title_settlements' and source_id = any($2::uuid[]) and status<>'cancelled'", [ctx.orgId, ids]);
  const deCredito = new Set(creditos.rows.map((c) => c.id.toLowerCase()));
  const todas = await ctx.tx.query<{ id: string; mov: string; title_id: string }>("select id::text as id, bank_movement_id::text as mov, title_id::text as title_id from erp.title_settlements where organization_id=$1 and bank_movement_id = any($2::uuid[]) and status='confirmed'", [ctx.orgId, movs]);
  const emS = new Set(ids);
  const liberados = new Set<string>(); const presos = new Set<string>();
  for (const m of movs) {
    const doMov = todas.rows.filter((x) => x.mov.toLowerCase() === m);
    const fora = doMov.filter((x) => !emS.has(x.id.toLowerCase()) && !deCredito.has(x.title_id.toLowerCase()));
    if (fora.length) presos.add(m);
    else if (doMov.filter((x) => emS.has(x.id.toLowerCase())).length >= 2) liberados.add(m);
  }
  return { liberados, presos };
}

/** Cancela os movimentos liberados (todas as baixas deles já estornadas), com a trilha e ROW COUNT. */
async function cancelarLiberados(ctx: ServiceCtx, liberados: ReadonlySet<string>, motivo: string, extra: Record<string, unknown>): Promise<number> {
  if (!liberados.size) return 0;
  const ids = [...liberados];
  const r = await ctx.tx.query("update erp.bank_movements set status='cancelled', cancel_reason=$3, cancelled_at=now(), cancelled_by=$4, updated_at=now() where id = any($1::uuid[]) and organization_id=$2 and status='confirmed'", [ids, ctx.orgId, motivo, ctx.user.id]);
  if (r.rowCount !== ids.length) throw err("CONFLICT", "Movimento bancário do lote não pôde ser estornado");
  for (const m of ids) await audit(ctx.tx, ctx, "bank_movements", m, "cancel", { reason: motivo, ...extra });
  return ids.length;
}

export default async function financeiroTitulosRoutes(app: FastifyInstance) {
  /** A CAPACIDADE da Central (forma e versão exatas, `entendeCentralFinanceira`). Qualquer membro autenticado. */
  app.get("/financeiro/capacidades", async (req) => runService(app, req, null, async () => ({ centralFinanceira: CAPACIDADE_CENTRAL_FINANCEIRA })));

  /** Títulos: cartões, totais, filtros e página no servidor; "Todos" vê só as direções que o usuário vê. */
  app.get("/financeiro/titulos", async (req) => runService(app, req, null, async (ctx0) => {
    const { ctx, dirs } = await porta(ctx0, "view");
    const q = consultaDeTitulosSchema.parse(req.query);
    return listarTitulosDaCentral(ctx, q, direcoesPedidas(q.direcao, dirs, "view"));
  }));

  /** Exportação da lista (mesmo recorte): CSV `;` com BOM ou XLSX, dinheiro em TEXTO decimal. `{dir}.export`. */
  app.get("/financeiro/titulos/exportar", async (req, reply) => {
    const arquivo = await runService(app, req, null, async (ctx0) => {
      const { ctx, dirs } = await porta(ctx0, "export");
      const q = exportacaoDeTitulosSchema.parse(req.query);
      const linhas = await linhasDaExportacao(ctx, q, direcoesPedidas(q.direcao, dirs, "export"));
      return { formato: q.formato, linhas };
    });
    if (arquivo.formato === "csv") {
      return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", "attachment; filename=\"titulos.csv\"").send(csvDaExportacao(arquivo.linhas));
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Títulos");
    ws.addRow([...COLUNAS_DA_EXPORTACAO]);
    // Toda célula vai como TEXTO (o dinheiro inclusive): nada passa por ponto flutuante a caminho da planilha.
    for (const l of arquivo.linhas) ws.addRow(l);
    const buf = await wb.xlsx.writeBuffer();
    return reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("Content-Disposition", "attachment; filename=\"titulos.xlsx\"").send(Buffer.from(buf as ArrayBuffer));
  });

  /**
   * Alterar vencimento e/ou conta prevista em lote, com MOTIVO na trilha. Vale também para título gerado por
   * documento ("vencimento e conta prevista podem mudar"). Cada título sai "alterado" ou "pulado" com o motivo.
   *
   * NEGAR NÃO REVELA EXISTÊNCIA: a direção sem `{dir}.edit` entra no WHERE (`t.direction = any(autorizadas)`), então o
   * título dela é, para quem pede, igual ao inexistente — "pulado: nao_encontrado". Antes a rota lia as DUAS direções
   * e respondia 403 nomeando a capacidade da outra: o UUID de um título a receber dava 403 e o inexistente dava 200,
   * um oráculo de existência e de variante (a rota antiga `GET /financial/payables/<o mesmo UUID>` responde 404).
   */
  app.post("/financeiro/titulos/alterar-vencimento", async (req) => runService(app, req, null, async (ctx0) => {
    const { ctx, dirs } = await porta(ctx0, "edit");
    const bruto = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const d = z.object({ ids: idsDoPedido, vencimento: z.string().refine(isISODate, "Data inválida").optional(), conta_prevista_id: uuid.nullable().optional(), motivo: MOTIVO }).strict().parse(bruto);
    const mudaConta = Object.prototype.hasOwnProperty.call(bruto, "conta_prevista_id") && bruto["conta_prevista_id"] !== undefined;
    if (!d.vencimento && !mudaConta) throw validation("Informe o novo vencimento ou a conta prevista");
    const params: unknown[] = [d.ids.map((x) => x.toLowerCase()), ctx.orgId, [...dirs]];
    const lidos = await ctx.tx.query<{ id: string; direction: Direcao; status: string; empresa_id: string; emission_date: string; due_date: string; conta_prevista_id: string | null }>(
      "select t.id::text as id, t.direction, t.status, t.empresa_id::text as empresa_id, t.emission_date, t.due_date, t.conta_prevista_id::text as conta_prevista_id from erp.financial_titles t where t.id = any($1::uuid[]) and t.organization_id=$2 and t.direction = any($3::text[]) and t.deleted_at is null"
      + empresaScopeSql(ctx, "t", params, { ignoreSelected: true }) + " order by t.id for update", params);
    if (d.conta_prevista_id) {
      const c = await ctx.tx.query("select 1 from erp.bank_accounts where id=$1 and organization_id=$2 and deleted_at is null and is_active", [d.conta_prevista_id, ctx.orgId]);
      if (c.rowCount !== 1) throw validation("Conta prevista inválida", [{ path: "conta_prevista_id", message: "Conta prevista inválida" }]);
    }
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "alterar_vencimento", ids: d.ids.map((x) => x.toLowerCase()), vencimento: d.vencimento ?? null, conta_prevista_id: mudaConta ? (d.conta_prevista_id ?? null) : "manter", motivo: d.motivo, actorId: ctx.user.id }, async () => {
      const porId = new Map(lidos.rows.map((x) => [x.id.toLowerCase(), x]));
      const itens: { id: string; resultado: "alterado" | "pulado"; motivo?: string }[] = [];
      const campo = d.vencimento && mudaConta ? "vencimento,conta_prevista" : d.vencimento ? "vencimento" : "conta_prevista";
      for (const id of d.ids) {
        const t = porId.get(id.toLowerCase());
        if (!t) { itens.push({ id, resultado: "pulado", motivo: "nao_encontrado" }); continue; }
        if (t.status !== "open" && t.status !== "partially_paid") { itens.push({ id, resultado: "pulado", motivo: "situacao" }); continue; }
        if (!(await periodoAbertoNoLote(ctx, t.empresa_id, t.emission_date))) { itens.push({ id, resultado: "pulado", motivo: "periodo_congelado" }); continue; }
        const novoVencimento = d.vencimento ?? t.due_date;
        const novaConta = mudaConta ? (d.conta_prevista_id ?? null) : t.conta_prevista_id;
        const u = await ctx.tx.query("update erp.financial_titles set due_date=$3, conta_prevista_id=$4, version=version+1 where id=$1 and organization_id=$2 and status in ('open','partially_paid')", [t.id, ctx.orgId, novoVencimento, novaConta]);
        if (u.rowCount !== 1) { itens.push({ id, resultado: "pulado", motivo: "situacao" }); continue; }
        await audit(ctx.tx, ctx, "financial_titles", t.id, "update", { motivo: d.motivo, campo }, { before: { due_date: t.due_date, conta_prevista_id: t.conta_prevista_id }, after: { due_date: novoVencimento, conta_prevista_id: novaConta } });
        itens.push({ id, resultado: "alterado" });
      }
      return { alterados: itens.filter((i) => i.resultado === "alterado").length, itens };
    })).result;
  }));

  /**
   * Estornar as baixas confirmadas dos títulos escolhidos (com MOTIVO). Baixa em lote com movimento único só sai
   * inteira: um título do lote sem os outros é pulado (`movimento_compartilhado`); com todos, o movimento é
   * estornado uma vez. Conciliado, crédito já usado, período congelado, sem baixa e invisível também são pulados
   * com o motivo. A direção sem `{dir}.cancel_settlement` entra no WHERE: o título dela é "nao_encontrado", como o
   * inexistente (sem 403 que revele a variante — ver alterar-vencimento).
   */
  app.post("/financeiro/titulos/estornar-baixas", async (req) => runService(app, req, null, async (ctx0) => {
    const { ctx, dirs } = await porta(ctx0, "cancel_settlement");
    const d = z.object({ ids: idsDoPedido, motivo: MOTIVO }).strict().parse(req.body);
    const params: unknown[] = [d.ids.map((x) => x.toLowerCase()), ctx.orgId, [...dirs]];
    const lidos = await ctx.tx.query<{ id: string; direction: Direcao; eh_adiantamento: boolean; empresa_id: string }>(
      `select t.id::text as id, t.direction, ${EH_ADIANTAMENTO_SQL("t")} as eh_adiantamento, t.empresa_id::text as empresa_id from erp.financial_titles t where t.id = any($1::uuid[]) and t.organization_id=$2 and t.direction = any($3::text[]) and t.deleted_at is null`
      + empresaScopeSql(ctx, "t", params, { ignoreSelected: true }) + " order by t.id for update", params);
    const visiveis = lidos.rows.map((x) => x.id);
    const baixas = visiveis.length ? (await ctx.tx.query<{ id: string; title_id: string; bank_movement_id: string | null; cross_title_id: string | null; settlement_date: string; empresa_contraria: string | null }>(
      "select s.id::text as id, s.title_id::text as title_id, s.bank_movement_id::text as bank_movement_id, s.cross_title_id::text as cross_title_id, s.settlement_date,"
      + " (select ct.empresa_id::text from erp.financial_titles ct where ct.id=s.cross_title_id and ct.organization_id=s.organization_id) as empresa_contraria"
      + " from erp.title_settlements s where s.organization_id=$1 and s.title_id = any($2::uuid[]) and s.status='confirmed' order by s.created_at, s.id",
      [ctx.orgId, visiveis])).rows : [];
    // Baixa cruzada: o estorno muta o outro lado — a capacidade contrária é exigida antes de qualquer efeito.
    for (const b of baixas) if (b.cross_title_id) { const dir = lidos.rows.find((x) => x.id === b.title_id)!.direction; requirePermission(ctx, permOf(dir === "payable" ? "receivable" : "payable", "cancel_settlement")); }
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "estornar_baixas", ids: d.ids.map((x) => x.toLowerCase()), motivo: d.motivo, actorId: ctx.user.id }, async () => {
      const motivoDe = new Map<string, string>();
      const doTitulo = (id: string) => baixas.filter((b) => b.title_id.toLowerCase() === id.toLowerCase());
      for (const id of d.ids) {
        const t = lidos.rows.find((x) => x.id.toLowerCase() === id.toLowerCase());
        if (!t) motivoDe.set(id.toLowerCase(), "nao_encontrado");
        else if (!doTitulo(t.id).length) motivoDe.set(id.toLowerCase(), "sem_baixa");
      }
      const sIds = baixas.map((b) => b.id);
      if (sIds.length) {
        // Conciliado: o principal ou um componente de alguma baixa do título.
        const conc = await ctx.tx.query<{ baixa: string }>(
          "select s.id::text as baixa from erp.title_settlements s join erp.bank_movements m on m.organization_id=s.organization_id and (m.id=s.bank_movement_id or m.title_settlement_id=s.id)"
          + " where s.id = any($1::uuid[]) and s.organization_id=$2 and m.status='confirmed' and m.reconciled_at is not null", [sIds, ctx.orgId]);
        for (const c of conc.rows) { const b = baixas.find((x) => x.id === c.baixa)!; if (!motivoDe.has(b.title_id.toLowerCase())) motivoDe.set(b.title_id.toLowerCase(), "movimento_conciliado"); }
        // Crédito: o gerado por uma baixa já usado, ou o título é um adiantamento com crédito usado.
        const usado = await ctx.tx.query<{ baixa: string }>("select c.source_id::text as baixa from erp.financial_titles c where c.organization_id=$1 and c.source_type='title_settlements' and c.source_id = any($2::uuid[]) and c.status<>'cancelled' and exists (select 1 from erp.title_settlements u where u.adiantamento_id=c.id and u.status='confirmed')", [ctx.orgId, sIds]);
        for (const c of usado.rows) { const b = baixas.find((x) => x.id === c.baixa)!; if (!motivoDe.has(b.title_id.toLowerCase())) motivoDe.set(b.title_id.toLowerCase(), "credito_usado"); }
        const adts = lidos.rows.filter((x) => x.eh_adiantamento).map((x) => x.id);
        if (adts.length) {
          const usos = await ctx.tx.query<{ id: string }>("select distinct adiantamento_id::text as id from erp.title_settlements where organization_id=$1 and adiantamento_id = any($2::uuid[]) and status='confirmed'", [ctx.orgId, adts]);
          for (const u of usos.rows) if (!motivoDe.has(u.id.toLowerCase())) motivoDe.set(u.id.toLowerCase(), "credito_usado");
        }
      }
      // Período congelado — o do título e, na cruzada, o do contrário: o título é PULADO com o motivo, como no
      // cancelamento em lote e no alterar vencimento (antes o `assertPeriodOpen` do estorno abortava o lote inteiro).
      // A conferência é por (empresa, data), com savepoint (`periodoAbertoNoLote`), e cada par é perguntado uma vez.
      const periodo = new Map<string, boolean>();
      const aberto = async (empresa: string, data: string) => {
        const chave = `${empresa.toLowerCase()}|${data}`;
        if (!periodo.has(chave)) periodo.set(chave, await periodoAbertoNoLote(ctx, empresa, data));
        return periodo.get(chave)!;
      };
      for (const b of baixas) {
        const chave = b.title_id.toLowerCase();
        if (motivoDe.has(chave)) continue;
        const t = lidos.rows.find((x) => x.id === b.title_id)!;
        if (!(await aberto(t.empresa_id, b.settlement_date)) || (b.empresa_contraria && !(await aberto(b.empresa_contraria, b.settlement_date)))) motivoDe.set(chave, "periodo_congelado");
      }
      // Movimento compartilhado: recorta até estabilizar (tirar um título pode prender o movimento de outro).
      let plano = { liberados: new Set<string>(), presos: new Set<string>() };
      for (;;) {
        const ativas = baixas.filter((b) => !motivoDe.has(b.title_id.toLowerCase()));
        plano = await planejarEstorno(ctx, ativas);
        const presos = ativas.filter((b) => b.bank_movement_id && plano.presos.has(b.bank_movement_id.toLowerCase()));
        if (!presos.length) break;
        for (const b of presos) motivoDe.set(b.title_id.toLowerCase(), "movimento_compartilhado");
      }
      for (const b of baixas) {
        if (motivoDe.has(b.title_id.toLowerCase())) continue;
        // O espelho de uma cruzada (ou o crédito de um excedente) pode já ter caído junto com uma baixa anterior.
        const st = await ctx.tx.query<{ status: string }>("select status from erp.title_settlements where id=$1 and organization_id=$2", [b.id, ctx.orgId]);
        if (st.rows[0]?.status !== "confirmed") continue;
        const dir = lidos.rows.find((x) => x.id === b.title_id)!.direction;
        await estornarBaixa(ctx, { tituloId: b.title_id, baixaId: b.id, direcao: dir, motivo: d.motivo, movimentosLiberados: plano.liberados });
      }
      await cancelarLiberados(ctx, plano.liberados, d.motivo, { estorno_em_lote: true });
      const canceladas = sIds.length ? (await ctx.tx.query<{ title_id: string; n: number }>("select title_id::text as title_id, count(*)::int as n from erp.title_settlements where id = any($1::uuid[]) and status='cancelled' group by 1", [sIds])).rows : [];
      const itens = d.ids.map((id) => {
        const motivo = motivoDe.get(id.toLowerCase());
        if (motivo) return { id, resultado: "pulado" as const, motivo, baixas: 0 };
        return { id, resultado: "estornado" as const, baixas: canceladas.find((c) => c.title_id.toLowerCase() === id.toLowerCase())?.n ?? 0 };
      });
      return { estornados: itens.filter((i) => i.resultado === "estornado").length, itens };
    })).result;
  }));

  /** O lote de baixa: as baixas, os movimentos (único, por título, componentes e tarifa) e a situação. */
  app.get("/financeiro/lotes-baixa/:loteId", async (req) => runService(app, req, null, async (ctx0) => {
    const { ctx } = await porta(ctx0, "view");
    const { loteId } = req.params as { loteId: string };
    const lote = await carregarLote(ctx, loteId, "view");
    const sIds = lote.baixas.map((b) => b.id);
    const principais = [...new Set(lote.baixas.flatMap((b) => (b.bank_movement_id ? [b.bank_movement_id] : [])))];
    const pm: unknown[] = [ctx.orgId, loteId, principais, sIds];
    const movs = await ctx.tx.query<{ id: string; codigo: string; valor: string; componente: string | null; status: string }>(
      "select m.id::text as id, m.code as codigo, m.amount::text as valor, m.componente_baixa as componente, m.status from erp.bank_movements m where m.organization_id=$1 and (m.lote_baixa_id=$2 or m.id = any($3::uuid[]) or m.title_settlement_id = any($4::uuid[]))"
      + empresaScopeSql(ctx, "m", pm, { nullable: true, ignoreSelected: true }) + " order by m.code", pm);
    const confirmadas = lote.baixas.filter((b) => b.status === "confirmed").length;
    const primeira = lote.baixas[0]!;
    return {
      lote_id: loteId.toLowerCase(), direcao: lote.direcao, data: primeira.settlement_date,
      conta: primeira.bank_account_id ? { id: primeira.bank_account_id, descricao: primeira.conta_descricao } : null,
      situacao: confirmadas === lote.baixas.length ? "confirmado" : confirmadas === 0 ? "estornado" : "parcial",
      total: money(sum(lote.baixas.map((b) => b.net_amount))),
      baixas: lote.baixas.map((b) => ({ id: b.id, titulo_id: b.titulo_id, codigo: b.codigo, numero: b.numero, pessoa_nome: b.pessoa_nome, valor: b.amount, liquido: b.net_amount, status: b.status })),
      movimentos: movs.rows
    };
  }));

  /** Estorno do LOTE inteiro (com motivo): todas as baixas confirmadas, o movimento único, os componentes e a tarifa. */
  app.post("/financeiro/lotes-baixa/:loteId/estorno", async (req) => runService(app, req, null, async (ctx0) => {
    const { ctx } = await porta(ctx0, "cancel_settlement");
    const { loteId } = req.params as { loteId: string };
    const lote = await carregarLote(ctx, loteId, "cancel_settlement");
    const d = z.object({ motivo: MOTIVO }).strict().parse(req.body);
    const ativas = lote.baixas.filter((b) => b.status === "confirmed");
    if (!ativas.length) throw err("ALREADY_CANCELLED", "Lote já estornado");
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "estornar_lote", loteId: loteId.toLowerCase(), motivo: d.motivo, actorId: ctx.user.id }, async () => {
      const plano = await planejarEstorno(ctx, ativas);
      if (plano.presos.size) throw err("CONFLICT", "Movimento bancário compartilhado com outras baixas: cancele todas ou lance ajuste");
      let movimentos = 0;
      for (const b of ativas) {
        const st = await ctx.tx.query<{ status: string }>("select status from erp.title_settlements where id=$1 and organization_id=$2", [b.id, ctx.orgId]);
        if (st.rows[0]?.status !== "confirmed") continue;
        movimentos += (await estornarBaixa(ctx, { tituloId: b.titulo_id, baixaId: b.id, direcao: lote.direcao, motivo: d.motivo, movimentosLiberados: plano.liberados })).movimentosCancelados.length;
      }
      movimentos += await cancelarLiberados(ctx, plano.liberados, d.motivo, { lote: loteId.toLowerCase() });
      return { lote_id: loteId.toLowerCase(), baixas_estornadas: ativas.length, movimentos_estornados: movimentos };
    })).result;
  }));

  /** Recibo do lote (texto PT-BR): empresa, data, conta, cada título, total e tarifa. `{dir}.receipt`. */
  app.get("/financeiro/lotes-baixa/:loteId/recibo", async (req) => runService(app, req, null, async (ctx0) => {
    const { ctx } = await porta(ctx0, "receipt");
    const { loteId } = req.params as { loteId: string };
    const lote = await carregarLote(ctx, loteId, "receipt");
    const confirmadas = lote.baixas.filter((b) => b.status === "confirmed");
    const pt: unknown[] = [ctx.orgId, loteId, confirmadas.map((b) => b.id)];
    const tarifa = await ctx.tx.query<{ valor: string }>("select coalesce(sum(m.amount),0)::text as valor from erp.bank_movements m where m.organization_id=$1 and m.status='confirmed' and m.componente_baixa='tarifa' and (m.lote_baixa_id=$2 or m.title_settlement_id = any($3::uuid[]))"
      + empresaScopeSql(ctx, "m", pt, { nullable: true, ignoreSelected: true }), pt);
    const primeira = lote.baixas[0]!;
    const linhas = confirmadas.map((b) => `${b.numero} (${b.codigo}) — ${b.pessoa_nome ?? "-"}: valor R$ ${b.amount}, líquido R$ ${b.net_amount}`);
    const recibo = [
      `RECIBO DE BAIXA EM LOTE — ${[...new Set(lote.baixas.map((b) => b.empresa_nome))].join(", ")}`,
      `Data: ${primeira.settlement_date}`,
      `Conta: ${primeira.conta_descricao ?? "-"}`,
      `${lote.direcao === "payable" ? "Pagamentos" : "Recebimentos"}:`,
      ...(linhas.length ? linhas : ["nenhuma baixa confirmada (lote estornado)"]),
      `Total: R$ ${money(sum(confirmadas.map((b) => b.net_amount)))}`,
      `Tarifa: R$ ${money(D(tarifa.rows[0]!.valor))}`
    ].join("\n");
    return { lote_id: loteId.toLowerCase(), recibo };
  }));
}

