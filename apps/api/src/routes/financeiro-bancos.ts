import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { D, isISODate, money } from "@agro/shared";
import { FORMA_UUID_PADRAO, NATUREZA_ESPERADA, rotuloFinanceiro, sugerirConciliacao, type ChaveNaturezaPadrao } from "@agro/domain";
import { runService, idempotent, audit, requirePermission, comPermissaoResolvida } from "../lib/service.js";
import { notFound, validation, err, denied } from "../lib/errors.js";
import { empresaScope, exigirEmpresaDeLancamento, hasPermission, type ServiceCtx } from "../lib/context.js";
import { createBankMovement, apportionmentSchema, MENSAGEM_CONTA_DESTINO_INVALIDA, MENSAGEM_CONTAS_IGUAIS } from "../services/financial-core.js";
import { anexarIdsGlobais, paginaComIdGlobal } from "../lib/id-global.js";
import {
  VALOR_COM_SINAL, MENSAGEM_CONTA_INVALIDA, MENSAGEM_TRANSACAO_RESOLVIDA,
  lerTransacao, vincularMovimentos, ignorarTransacao, desfazerConciliacao, importarOfx, naoEncontrada
} from "../lib/financeiro-conciliacao.js";
import { montarFluxo, montarResultado } from "../lib/financeiro-fluxo.js";

/**
 * CENTRAL FINANCEIRA — BANCOS E CAIXA, CONCILIAÇÃO, FLUXO E RESULTADO, ADIANTAMENTOS E NATUREZAS PADRÃO
 * (OPERACOES-01 F8, decisão 285). Rotas NOVAS em prefixo próprio (`/financeiro/*`): a API anterior não as tem, e o
 * 404 de rota dela é a ausência da Central (a capacidade mora em `GET /financeiro/capacidades`).
 *
 * Convenções de toda rota daqui: corpo e query ESTRITOS (chave desconhecida = 422, nunca ignorada); id de caminho
 * malformado = a MESMA 404 do inexistente (a forma é testada antes do SQL); 403 só para falta de capacidade;
 * dinheiro em `numeric` no banco, `D`/`money` no código e TEXTO na resposta; filtro, paginação e ordenação no
 * servidor, sem N+1; `Idempotency-Key` nas escritas (a chave leva a ação, os ids em minúsculas e o autor); ROW COUNT
 * conferido em toda gravação sob RLS; trilha (`audit`) em toda escrita.
 *
 * SALDO DE CONTA É DA ORGANIZAÇÃO (MULTI-COMPANY §7): contas, extrato e o fluxo da organização exigem a capacidade
 * de organização `bank_accounts.view` E a financeira `bank_movements.view`, e leem os movimentos pela função estreita
 * `erp.extrato_conta_organizacao` (0042) — uma permissão de empresa não devolve em silêncio um agregado que soma
 * empresas que o usuário não vê, e o recorte de empresa não deixa o saldo de conta errado.
 */

const UUID = z.string().uuid();
const DATA = z.string().refine(isISODate, "Data inválida");
/** Dinheiro em TEXTO decimal (o contrato da API): nunca número de ponto flutuante. */
const VALOR = z.string().regex(/^-?\d{1,16}(\.\d{1,2})?$/, "Valor inválido");
const VALOR_POSITIVO = VALOR.refine((v) => D(v).gt(0), "O valor deve ser positivo");
const TEXTO = (max: number) => z.string().trim().max(max);
const paginacao = (padrao: number) => ({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(padrao)
});
/** Lista de uuid separados por vírgula na query (`contas=a,b`). Um item malformado recusa a lista inteira (422). */
const LISTA_DE_UUID = z.string().max(4000)
  .transform((v) => v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(UUID).min(1).max(100));
const idem = (req: FastifyRequest): string | undefined => {
  const h = req.headers["idempotency-key"];
  return typeof h === "string" && h ? h : undefined;
};
const permOf = (dir: "payable" | "receivable", acao: string) => `${dir === "payable" ? "payables" : "receivables"}.${acao}`;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const offset = (q: { page: number; pageSize: number }) => (q.page - 1) * q.pageSize;

/** Período "de/até" da query: os dois ou nenhum (o mês corrente, pela data do banco). */
async function intervalo(ctx: ServiceCtx, de: string | undefined, ate: string | undefined): Promise<{ de: string; ate: string }> {
  if (de && ate) {
    if (de > ate) throw validation("Período inválido: o início é depois do fim", [{ path: ["de"], message: "Período inválido" }]);
    return { de, ate };
  }
  if (de || ate) throw validation("Informe o início e o fim do período", [{ path: [de ? "ate" : "de"], message: "Campo obrigatório" }]);
  const r = await ctx.tx.query<{ de: string; ate: string }>(
    "select to_char(date_trunc('month', current_date),'YYYY-MM-DD') as de, to_char((date_trunc('month', current_date) + interval '1 month - 1 day')::date,'YYYY-MM-DD') as ate");
  return r.rows[0]!;
}

// ---------------------------------------------------------------------------------------------------------------
// Contas e extrato (agregado de ORGANIZAÇÃO)
// ---------------------------------------------------------------------------------------------------------------
interface LinhaConta {
  id: string; codigo: string; descricao: string; tipo: string; banco: string | null; agencia: string | null; conta: string | null; ativa: boolean;
  saldo_inicial: string; data_saldo_inicial: string | null; saldo_real: string; saldo_conciliado: string; conciliado_ate: string | null;
}
/** O valor com sinal sobre o alias `x` (as linhas da função organizacional). */
const SINAL_X = VALOR_COM_SINAL.replace(/m\./g, "x.");

/**
 * As contas com saldo REAL (saldo inicial do cadastro + todos os movimentos confirmados) e saldo CONCILIADO (saldo
 * inicial + só os movimentos com a marca de conciliado), numa consulta: a função organizacional é varrida UMA vez,
 * agregada por conta, e a página e os totais saem do mesmo conjunto.
 */
async function contasComSaldo(ctx: ServiceCtx, f: { ids?: string[]; ativas: boolean; page: number; pageSize: number }): Promise<{ itens: LinhaConta[]; total: number; totais: { saldo_real: string; saldo_conciliado: string } }> {
  const r = await ctx.tx.query<{ total: number; saldo_real: string; saldo_conciliado: string; itens: LinhaConta[] }>(
    `with s as (
       select x.bank_account_id,
              sum(${SINAL_X}) as real,
              coalesce(sum(${SINAL_X}) filter (where x.reconciled_at is not null),0) as conciliado,
              max(x.movement_date) filter (where x.reconciled_at is not null) as conciliado_ate
         from erp.extrato_conta_organizacao($2::uuid[], null, null) x group by 1),
     l as (
       select a.id, a.code, a.description, a.type, a.bank_code, a.agency, a.account_number, a.is_active, a.opening_balance, a.data_saldo_inicial,
              a.opening_balance + coalesce(s.real,0) as saldo_real, a.opening_balance + coalesce(s.conciliado,0) as saldo_conciliado, s.conciliado_ate
         from erp.bank_accounts a left join s on s.bank_account_id=a.id
        where a.organization_id=$1 and a.deleted_at is null and ($2::uuid[] is null or a.id = any($2::uuid[])) and ($3::boolean = false or a.is_active))
     select (select count(*) from l)::int as total,
            (select coalesce(sum(saldo_real),0) from l)::text as saldo_real,
            (select coalesce(sum(saldo_conciliado),0) from l)::text as saldo_conciliado,
            coalesce((select json_agg(p order by p.codigo, p.id) from (
               select l.id, l.code as codigo, l.description as descricao, l.type as tipo, l.bank_code as banco, l.agency as agencia, l.account_number as conta,
                      l.is_active as ativa, l.opening_balance::text as saldo_inicial, to_char(l.data_saldo_inicial,'YYYY-MM-DD') as data_saldo_inicial,
                      l.saldo_real::text as saldo_real, l.saldo_conciliado::text as saldo_conciliado, to_char(l.conciliado_ate,'YYYY-MM-DD') as conciliado_ate
                 from l order by l.code, l.id limit $4 offset $5) p), '[]'::json) as itens`,
    [ctx.orgId, f.ids ?? null, f.ativas, f.pageSize, offset(f)]);
  const x = r.rows[0]!;
  return { itens: x.itens, total: x.total, totais: { saldo_real: money(x.saldo_real), saldo_conciliado: money(x.saldo_conciliado) } };
}

/** A conta pela organização, viva. Malformado, inexistente, de outra organização e excluída: a MESMA 404. */
async function lerConta(ctx: ServiceCtx, id: string, opts: { travar?: boolean } = {}) {
  if (!FORMA_UUID_PADRAO.test(id)) throw naoEncontrada("Conta bancária");
  const r = await ctx.tx.query<{ id: string; codigo: string; descricao: string; tipo: string; saldo_inicial: string; data_saldo_inicial: string | null }>(
    `select id, code as codigo, description as descricao, type as tipo, opening_balance::text as saldo_inicial, to_char(data_saldo_inicial,'YYYY-MM-DD') as data_saldo_inicial
       from erp.bank_accounts where id=$1 and organization_id=$2 and deleted_at is null${opts.travar ? " for update" : ""}`, [id, ctx.orgId]);
  if (!r.rows[0]) throw naoEncontrada("Conta bancária");
  return r.rows[0];
}

const SITUACAO_DO_EXTRATO = { todos: "true", conciliados: "x.reconciled_at is not null", pendentes: "x.reconciled_at is null" } as const;

/**
 * Extrato de UMA conta com saldo real × conciliado ACUMULADOS. O acumulado é uma janela sobre TODOS os movimentos do
 * período (o filtro de situação recorta as linhas mostradas, não o saldo), e a paginação vem DEPOIS da janela: a
 * página 2 começa do acumulado certo. Saldo anterior = saldo inicial do cadastro + movimentos antes do início; sem
 * início pedido, o início é a data do saldo inicial da conta (quando declarada).
 */
async function extratoDaConta(ctx: ServiceCtx, q: { conta_id: string; de?: string; ate?: string; situacao: keyof typeof SITUACAO_DO_EXTRATO; page: number; pageSize: number }) {
  const conta = await lerConta(ctx, q.conta_id);
  const de = q.de ?? conta.data_saldo_inicial ?? null;
  const ate = q.ate ?? null;
  if (de && ate && de > ate) throw validation("Período inválido: o início é depois do fim", [{ path: ["de"], message: "Período inválido" }]);
  const antes = de
    ? (await ctx.tx.query<{ real: string; conciliado: string }>(
        `select coalesce(sum(${SINAL_X}),0)::text as real, coalesce(sum(${SINAL_X}) filter (where x.reconciled_at is not null),0)::text as conciliado
           from erp.extrato_conta_organizacao(array[$1]::uuid[], null, ($2::date - 1)) x`, [conta.id, de])).rows[0]!
    : { real: "0", conciliado: "0" };
  const saldoAnterior = { real: money(D(conta.saldo_inicial).plus(antes.real)), conciliado: money(D(conta.saldo_inicial).plus(antes.conciliado)) };
  const filtro = SITUACAO_DO_EXTRATO[q.situacao];
  const periodo = await ctx.tx.query<{ n: number; real: string; conciliado: string }>(
    `select (count(*) filter (where ${filtro}))::int as n, coalesce(sum(${SINAL_X}),0)::text as real, coalesce(sum(${SINAL_X}) filter (where x.reconciled_at is not null),0)::text as conciliado
       from erp.extrato_conta_organizacao(array[$1]::uuid[], $2::date, $3::date) x`, [conta.id, de, ate]);
  const sinalE = VALOR_COM_SINAL.replace(/m\./g, "e.");
  const linhas = await ctx.tx.query<Record<string, unknown> & { id: string }>(
    `select x.id, x.code as codigo, to_char(x.movement_date,'YYYY-MM-DD') as data, x.note as descricao, x.document as documento, x.type as tipo,
            x.category_type as categoria, x.tipo_transferencia, x.valor::text as valor, (x.reconciled_at is not null) as conciliado, x.reconciled_at as conciliado_em,
            x.source_type as origem, x.empresa_id, ($4::numeric + x.acumulado_real)::text as saldo_real, ($5::numeric + x.acumulado_conciliado)::text as saldo_conciliado
       from (select e.*, ${sinalE} as valor,
                    sum(${sinalE}) over w as acumulado_real,
                    sum(case when e.reconciled_at is not null then ${sinalE} else 0 end) over w as acumulado_conciliado
               from erp.extrato_conta_organizacao(array[$1]::uuid[], $2::date, $3::date) e
             window w as (order by e.movement_date, e.created_at, e.id rows between unbounded preceding and current row)) x
      where ${filtro}
      order by x.movement_date, x.created_at, x.id limit $6 offset $7`,
    [conta.id, de, ate, saldoAnterior.real, saldoAnterior.conciliado, q.pageSize, offset(q)]);
  const p = periodo.rows[0]!;
  return {
    conta, de, ate, situacao: q.situacao, saldo_anterior: saldoAnterior,
    itens: await anexarIdsGlobais(ctx, "bank_movements", linhas.rows), total: p.n, page: q.page, pageSize: q.pageSize,
    saldo_final: { real: money(D(saldoAnterior.real).plus(p.real)), conciliado: money(D(saldoAnterior.conciliado).plus(p.conciliado)) }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Transferências entre contas
// ---------------------------------------------------------------------------------------------------------------
const TIPOS_TRANSFERENCIA = ["transferencia", "deposito", "saque", "aplicacao", "resgate"] as const;
type TipoTransferencia = (typeof TIPOS_TRANSFERENCIA)[number];

/**
 * A regra de cada rótulo pelo TIPO das contas (`cash` = caixa, `investment` = aplicação). Nenhum deles é receita nem
 * despesa: todos são `internal_transfer` com o par na conta destino, sem rateio.
 */
function regraDoTipo(tipo: TipoTransferencia, origem: string, destino: string): string | null {
  switch (tipo) {
    case "deposito": return origem === "cash" && destino !== "cash" ? null : "Depósito é do caixa para uma conta que não é caixa";
    case "saque": return origem !== "cash" && destino === "cash" ? null : "Saque é de uma conta que não é caixa para o caixa";
    case "aplicacao": return destino === "investment" && origem !== "investment" ? null : "Aplicação é de uma conta comum para uma conta de aplicação";
    case "resgate": return origem === "investment" && destino !== "investment" ? null : "Resgate é de uma conta de aplicação para uma conta comum";
    case "transferencia": return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Adiantamentos (crédito por parceiro × empresa)
// ---------------------------------------------------------------------------------------------------------------
/** É adiantamento: forma de pagamento `advance` OU tipo de título marcado `is_advance` (o defeito: `is_advance` não era lido). */
const EH_ADIANTAMENTO = "(t.payment_type='advance' or exists (select 1 from erp.title_types tt where tt.id=t.title_type_id and tt.is_advance))";
/** Crédito usado = soma das baixas CONFIRMADAS que usaram este adiantamento (`adiantamento_id`). */
const USADO_DO_ADIANTAMENTO = "coalesce((select sum(s.amount) from erp.title_settlements s where s.adiantamento_id=t.id and s.organization_id=t.organization_id and s.status='confirmed'),0)::numeric(18,2)";

/** Direções pedidas ∩ direções que o usuário VÊ; nenhuma → 403. A porta é dinâmica: o módulo é publicado na transação. */
async function porDirecoes(ctx0: ServiceCtx, pedida: "payable" | "receivable" | "todos"): Promise<{ ctx: ServiceCtx; direcoes: ("payable" | "receivable")[] }> {
  const pedidas: ("payable" | "receivable")[] = pedida === "todos" ? ["receivable", "payable"] : [pedida];
  const direcoes = pedidas.filter((d) => hasPermission(ctx0, permOf(d, "view")));
  if (!direcoes.length) throw denied(permOf(pedidas[0]!, "view"));
  return { ctx: await comPermissaoResolvida(ctx0, permOf(direcoes[0]!, "view")), direcoes };
}

// ---------------------------------------------------------------------------------------------------------------
// Naturezas padrão da baixa (configuração da organização)
// ---------------------------------------------------------------------------------------------------------------
/** Lista FECHADA das colunas (nunca nome de coluna vindo da entrada) e o rótulo de cada uma. */
const NATUREZAS_PADRAO: readonly { chave: ChaveNaturezaPadrao; nome: string; rotulo: string }[] = [
  { chave: "juros_pagos_id", nome: "juros_pagos", rotulo: "Juros pagos" },
  { chave: "juros_recebidos_id", nome: "juros_recebidos", rotulo: "Juros recebidos" },
  { chave: "multa_paga_id", nome: "multa_paga", rotulo: "Multa paga" },
  { chave: "multa_recebida_id", nome: "multa_recebida", rotulo: "Multa recebida" },
  { chave: "acrescimo_pago_id", nome: "acrescimo_pago", rotulo: "Acréscimo pago" },
  { chave: "acrescimo_recebido_id", nome: "acrescimo_recebido", rotulo: "Acréscimo recebido" },
  { chave: "desconto_obtido_id", nome: "desconto_obtido", rotulo: "Desconto obtido" },
  { chave: "desconto_concedido_id", nome: "desconto_concedido", rotulo: "Desconto concedido" },
  { chave: "tarifa_bancaria_id", nome: "tarifa_bancaria", rotulo: "Tarifa bancária" }
];
const ID_OU_NULO = UUID.nullable().optional();
const naturezasPadraoSchema = z.object({
  juros_pagos_id: ID_OU_NULO, juros_recebidos_id: ID_OU_NULO, multa_paga_id: ID_OU_NULO, multa_recebida_id: ID_OU_NULO,
  acrescimo_pago_id: ID_OU_NULO, acrescimo_recebido_id: ID_OU_NULO, desconto_obtido_id: ID_OU_NULO, desconto_concedido_id: ID_OU_NULO,
  tarifa_bancaria_id: ID_OU_NULO
}).strict();

type NaturezaResumida = { id: string; codigo: string; nome: string } | null;
/** A configuração da organização (ou tudo nulo, sem linha) e a resposta `{ juros_pagos: {id, codigo, nome} | null, … }`. */
async function naturezasPadraoDaOrganizacao(ctx: ServiceCtx): Promise<Record<string, NaturezaResumida>> {
  const colunas = NATUREZAS_PADRAO.map((n) => `np.${n.chave}::text as ${n.chave}`).join(", ");
  const r = await ctx.tx.query<Partial<Record<ChaveNaturezaPadrao, string | null>>>(`select ${colunas} from erp.financeiro_naturezas_padrao np where np.organization_id=$1`, [ctx.orgId]);
  const linha = r.rows[0] ?? {};
  const ids = [...new Set(NATUREZAS_PADRAO.map((n) => linha[n.chave]).filter((x): x is string => Boolean(x)))];
  const nat = ids.length
    ? (await ctx.tx.query<{ id: string; code: string; name: string }>("select id, code, name from erp.financial_categories where organization_id=$1 and id = any($2::uuid[])", [ctx.orgId, ids])).rows
    : [];
  const porId = new Map(nat.map((n) => [n.id, n]));
  return Object.fromEntries(NATUREZAS_PADRAO.map((n) => {
    const id = linha[n.chave];
    const c = id ? porId.get(id) : undefined;
    return [n.nome, c ? { id: c.id, codigo: c.code, nome: c.name } : null];
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Esquemas (todos estritos)
// ---------------------------------------------------------------------------------------------------------------
const contasQuery = z.object({ ...paginacao(50), ativas: z.enum(["0", "1"]).default("1") }).strict();
const saldoInicialSchema = z.object({ valor: VALOR, data: DATA }).strict();
const extratoQuery = z.object({ conta_id: z.string().max(64), de: DATA.optional(), ate: DATA.optional(), situacao: z.enum(["todos", "conciliados", "pendentes"]).default("todos"), ...paginacao(100) }).strict();
const transferenciaSchema = z.object({
  tipo: z.enum(TIPOS_TRANSFERENCIA), conta_origem_id: UUID, conta_destino_id: UUID, data: DATA, valor: VALOR_POSITIVO, empresa_id: UUID,
  documento: TEXTO(60).nullable().optional(), observacao: TEXTO(500).nullable().optional()
}).strict();
const importacoesQuery = z.object({ conta_id: UUID.optional(), situacao: z.enum(["imported", "reconciling", "reconciled"]).optional(), ...paginacao(50) }).strict();
const importarSchema = z.object({ conta_id: UUID, descricao: TEXTO(200).min(1), conteudo: z.string().min(10).max(2_000_000) }).strict();
const importacaoQuery = z.object({ situacao: z.enum(["pending", "matched", "ignored"]).optional(), ...paginacao(100) }).strict();
const candidatosQuery = z.object({ de: DATA.optional(), ate: DATA.optional(), busca: TEXTO(100).optional(), ...paginacao(50) }).strict();
const confirmarSchema = z.object({ movimento_ids: z.array(UUID).min(1).max(10) }).strict();
const criarLancamentoSchema = z.object({ empresa_id: UUID, rateio: apportionmentSchema, observacao: TEXTO(500).nullable().optional() }).strict();
const ignorarSchema = z.object({ motivo: TEXTO(500).nullable().optional() }).strict();
const desfazerSchema = z.object({ motivo: TEXTO(500).min(1) }).strict();
const fluxoQuery = z.object({
  de: DATA.optional(), ate: DATA.optional(), agrupamento: z.enum(["dia", "semana", "mes"]).default("dia"), contas: LISTA_DE_UUID.optional(),
  empresa_id: UUID.optional(), agrupar_por: z.enum(["nenhum", "conta", "empresa"]).default("nenhum"), previstos: z.enum(["0", "1"]).default("0")
}).strict();
const resultadoQuery = z.object({ de: DATA.optional(), ate: DATA.optional(), regime: z.enum(["competencia", "caixa"]).default("competencia"), empresa_id: UUID.optional() }).strict();
const adiantamentosQuery = z.object({
  direcao: z.enum(["payable", "receivable", "todos"]).default("todos"), pessoa_id: UUID.optional(), empresa_id: UUID.optional(),
  so_com_saldo: z.enum(["0", "1"]).default("1"), ...paginacao(50)
}).strict();
const titulosDeAdiantamentoQuery = z.object({ direcao: z.enum(["payable", "receivable"]), pessoa_id: UUID.optional(), empresa_id: UUID.optional(), ...paginacao(50) }).strict();

export default async function financeiroBancosRoutes(app: FastifyInstance) {
  // ---------- Contas e extrato ----------
  app.get("/financeiro/contas", async (req) => runService(app, req, "bank_accounts.view", async (ctx) => {
    requirePermission(ctx, "bank_movements.view");
    const q = contasQuery.parse(req.query);
    const r = await contasComSaldo(ctx, { ativas: q.ativas === "1", page: q.page, pageSize: q.pageSize });
    return { itens: r.itens, total: r.total, page: q.page, pageSize: q.pageSize, totais: r.totais };
  }));

  app.put("/financeiro/contas/:id/saldo-inicial", async (req) => runService(app, req, "bank_accounts.edit", async (ctx) => {
    // A resposta é a linha da conta COM os saldos — que só sai pela porta organizacional (as duas capacidades).
    requirePermission(ctx, "bank_accounts.view"); requirePermission(ctx, "bank_movements.view");
    const { id } = req.params as { id: string };
    const antes = await lerConta(ctx, id, { travar: true });
    const d = saldoInicialSchema.parse(req.body);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "saldo_inicial_conta", contaId: antes.id, valor: money(d.valor), data: d.data, actorId: ctx.user.id }, async () => {
      const r = await ctx.tx.query("update erp.bank_accounts set opening_balance=$3, data_saldo_inicial=$4, updated_at=now() where id=$1 and organization_id=$2 and deleted_at is null", [antes.id, ctx.orgId, money(d.valor), d.data]);
      if (r.rowCount !== 1) throw naoEncontrada("Conta bancária");
      await audit(ctx.tx, ctx, "bank_accounts", antes.id, "update", { campo: "saldo_inicial" },
        { before: { saldo_inicial: antes.saldo_inicial, data_saldo_inicial: antes.data_saldo_inicial }, after: { saldo_inicial: money(d.valor), data_saldo_inicial: d.data } });
      const linha = (await contasComSaldo(ctx, { ids: [antes.id], ativas: false, page: 1, pageSize: 1 })).itens[0];
      if (!linha) throw naoEncontrada("Conta bancária");
      return linha;
    })).result;
  }));

  app.get("/financeiro/extrato", async (req) => runService(app, req, "bank_accounts.view", async (ctx) => {
    requirePermission(ctx, "bank_movements.view");
    return extratoDaConta(ctx, extratoQuery.parse(req.query));
  }));

  // ---------- Transferências entre contas ----------
  app.post("/financeiro/transferencias", async (req, reply) => reply.status(201).send(await runService(app, req, "bank_movements.create", async (ctx) => {
    const d = transferenciaSchema.parse(req.body);
    await exigirEmpresaDeLancamento(ctx, d.empresa_id);
    const origemId = d.conta_origem_id.toLowerCase();
    const destinoId = d.conta_destino_id.toLowerCase();
    if (origemId === destinoId) throw validation(MENSAGEM_CONTAS_IGUAIS, [{ path: ["conta_destino_id"], message: MENSAGEM_CONTAS_IGUAIS }]);
    const contas = await ctx.tx.query<{ id: string; type: string }>(
      "select id, type from erp.bank_accounts where organization_id=$1 and deleted_at is null and is_active and id = any($2::uuid[])", [ctx.orgId, [origemId, destinoId]]);
    const origem = contas.rows.find((c) => c.id === origemId);
    const destino = contas.rows.find((c) => c.id === destinoId);
    if (!origem) throw validation(MENSAGEM_CONTA_INVALIDA, [{ path: ["conta_origem_id"], message: MENSAGEM_CONTA_INVALIDA }]);
    if (!destino) throw validation(MENSAGEM_CONTA_DESTINO_INVALIDA, [{ path: ["conta_destino_id"], message: MENSAGEM_CONTA_DESTINO_INVALIDA }]);
    const recusa = regraDoTipo(d.tipo, origem.type, destino.type);
    if (recusa) throw validation(recusa, [{ path: ["tipo"], message: recusa }]);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "transferencia_entre_contas", ...d, conta_origem_id: origemId, conta_destino_id: destinoId, empresa_id: d.empresa_id.toLowerCase(), actorId: ctx.user.id }, async () => {
      const id = await createBankMovement(ctx, {
        empresaId: d.empresa_id, bankAccountId: origemId, destinationAccountId: destinoId, date: d.data, type: "out", categoryType: "internal_transfer",
        tipoTransferencia: d.tipo, amount: d.valor, document: d.documento ?? null, note: d.observacao || rotuloFinanceiro("tipo_transferencia", d.tipo), sourceType: "manual"
      });
      const par = await ctx.tx.query<{ par: string | null }>("select transfer_pair_id as par from erp.bank_movements where id=$1 and organization_id=$2", [id, ctx.orgId]);
      if (!par.rows[0]?.par) throw notFound("Movimento");
      await audit(ctx.tx, ctx, "bank_movements", id, "create", { tipo_transferencia: d.tipo, par_id: par.rows[0].par });
      return { id, par_id: par.rows[0].par };
    })).result;
  })));

  // ---------- Conciliação OFX ----------
  app.get("/financeiro/conciliacao/importacoes", async (req) => runService(app, req, "ofx_imports.view", async (ctx) => {
    const q = importacoesQuery.parse(req.query);
    const params: unknown[] = [ctx.orgId];
    const where = ["i.organization_id=$1", "i.deleted_at is null"];
    if (q.conta_id) { params.push(q.conta_id); where.push(`i.bank_account_id=$${params.length}`); }
    if (q.situacao) { params.push(q.situacao); where.push(`i.status=$${params.length}`); }
    const total = await ctx.tx.query<{ n: number }>(`select count(*)::int as n from erp.ofx_imports i where ${where.join(" and ")}`, params);
    const r = await ctx.tx.query<Record<string, unknown>>(
      `select i.id, i.code as codigo, i.description as descricao, i.bank_account_id as conta_id, ba.code || ' — ' || ba.description as conta,
              to_char(i.start_date,'YYYY-MM-DD') as de, to_char(i.end_date,'YYYY-MM-DD') as ate, i.status as situacao,
              c.transacoes, c.conciliadas, c.ignoradas, c.pendentes, i.created_at as criado_em
         from erp.ofx_imports i join erp.bank_accounts ba on ba.id=i.bank_account_id and ba.organization_id=i.organization_id
         cross join lateral (select count(*)::int as transacoes, (count(*) filter (where t.status='matched'))::int as conciliadas,
                                    (count(*) filter (where t.status='ignored'))::int as ignoradas, (count(*) filter (where t.status='pending'))::int as pendentes
                               from erp.ofx_transactions t where t.import_id=i.id and t.organization_id=i.organization_id) c
        where ${where.join(" and ")} order by i.created_at desc, i.id limit ${q.pageSize} offset ${offset(q)}`, params);
    const pagina = await paginaComIdGlobal(ctx, "ofx_imports", { items: r.rows });
    return { itens: pagina.items, total: total.rows[0]!.n, page: q.page, pageSize: q.pageSize, idGlobal: pagina.idGlobal };
  }));

  app.post("/financeiro/conciliacao/importacoes", async (req, reply) => reply.status(201).send(await runService(app, req, "ofx_imports.create", async (ctx) => {
    const d = importarSchema.parse(req.body);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "importar_ofx", conta_id: d.conta_id.toLowerCase(), descricao: d.descricao, conteudo: d.conteudo, actorId: ctx.user.id },
      () => importarOfx(ctx, { contaId: d.conta_id, descricao: d.descricao, conteudo: d.conteudo }))).result;
  })));

  app.get("/financeiro/conciliacao/importacoes/:id", async (req) => runService(app, req, "ofx_imports.view", async (ctx) => {
    const { id } = req.params as { id: string };
    if (!FORMA_UUID_PADRAO.test(id)) throw naoEncontrada("Importação");
    const q = importacaoQuery.parse(req.query);
    const imp = await ctx.tx.query<Record<string, unknown> & { id: string; conta_id: string }>(
      `select i.id, i.code as codigo, i.description as descricao, i.bank_account_id as conta_id, ba.code || ' — ' || ba.description as conta,
              to_char(i.start_date,'YYYY-MM-DD') as de, to_char(i.end_date,'YYYY-MM-DD') as ate, i.status as situacao, i.created_at as criado_em,
              c.transacoes, c.conciliadas, c.ignoradas, c.pendentes
         from erp.ofx_imports i join erp.bank_accounts ba on ba.id=i.bank_account_id and ba.organization_id=i.organization_id
         cross join lateral (select count(*)::int as transacoes, (count(*) filter (where t.status='matched'))::int as conciliadas,
                                    (count(*) filter (where t.status='ignored'))::int as ignoradas, (count(*) filter (where t.status='pending'))::int as pendentes
                               from erp.ofx_transactions t where t.import_id=i.id and t.organization_id=i.organization_id) c
        where i.id=$1 and i.organization_id=$2 and i.deleted_at is null`, [id, ctx.orgId]);
    if (!imp.rows[0]) throw naoEncontrada("Importação");
    const importacao = (await anexarIdsGlobais(ctx, "ofx_imports", imp.rows))[0]!;
    const params: unknown[] = [importacao.id, ctx.orgId];
    let filtro = "";
    if (q.situacao) { params.push(q.situacao); filtro = ` and t.status=$${params.length}`; }
    const total = await ctx.tx.query<{ n: number }>(`select count(*)::int as n from erp.ofx_transactions t where t.import_id=$1 and t.organization_id=$2${filtro}`, params);
    const transacoes = await ctx.tx.query<{ id: string; fitid: string; data: string; valor: string; memo: string | null; situacao: string }>(
      `select t.id, t.fitid, to_char(t.posted_date,'YYYY-MM-DD') as data, t.amount::text as valor, t.memo, t.status as situacao
         from erp.ofx_transactions t where t.import_id=$1 and t.organization_id=$2${filtro}
        order by t.posted_date, t.fitid, t.id limit ${q.pageSize} offset ${offset(q)}`, params);
    const ids = transacoes.rows.map((t) => t.id);
    type Mov = { id: string; codigo: string; data: string; valor: string; observacao: string | null; ofx_transaction_id: string | null };
    // Os movimentos são de EMPRESA: além da RLS, o escopo do módulo (o sem empresa é da organização e continua
    // visível); a empresa SELECIONADA não recorta — a conciliação é da conta inteira.
    const escopoMov = (params: unknown[]) => empresaScope(ctx, "m", params, { nullable: true, ignoreSelected: true }).map((c) => ` and ${c}`).join("");
    // Movimentos JÁ vinculados às transações da página — uma consulta.
    const pv: unknown[] = [ctx.orgId, ids];
    const vinculados = ids.length ? (await ctx.tx.query<Mov>(
      `select m.id, m.code as codigo, to_char(m.movement_date,'YYYY-MM-DD') as data, ${VALOR_COM_SINAL}::text as valor, m.note as observacao, m.ofx_transaction_id
         from erp.bank_movements m where m.organization_id=$1 and m.ofx_transaction_id = any($2::uuid[])${escopoMov(pv)} order by length(m.code), m.code, m.id`, pv)).rows : [];
    // Candidatos das sugestões: UMA consulta para a página inteira (movimentos confirmados e não conciliados da conta,
    // de 3 dias antes da menor data a 3 dias depois da maior, sob a RLS), e a regra é a do domínio.
    const pendentes = transacoes.rows.filter((t) => t.situacao === "pending");
    const datas = pendentes.map((t) => t.data).sort();
    const pc: unknown[] = [ctx.orgId, importacao.conta_id, datas[0], datas[datas.length - 1]];
    const candidatos = pendentes.length ? (await ctx.tx.query<Mov>(
      `select m.id, m.code as codigo, to_char(m.movement_date,'YYYY-MM-DD') as data, ${VALOR_COM_SINAL}::text as valor, m.note as observacao, m.ofx_transaction_id
         from erp.bank_movements m
        where m.organization_id=$1 and m.bank_account_id=$2 and m.status='confirmed' and m.reconciled_at is null and m.deleted_at is null
          and m.movement_date between ($3::date - 3) and ($4::date + 3)${escopoMov(pc)}
        order by m.movement_date, m.id`, pc)).rows : [];
    const sugestoes = new Map(sugerirConciliacao(pendentes.map((t) => ({ id: t.id, data: t.data, valor: t.valor })), candidatos).map((s) => [s.transacaoId, s]));
    const porId = new Map(candidatos.map((m) => [m.id, m]));
    const resumo = (m: Mov) => ({ id: m.id, codigo: m.codigo, data: m.data, valor: money(m.valor), observacao: m.observacao });
    return {
      importacao,
      transacoes: transacoes.rows.map((t) => {
        const s = sugestoes.get(t.id);
        return {
          ...t, valor: money(t.valor),
          movimentos: vinculados.filter((m) => m.ofx_transaction_id === t.id).map(resumo),
          sugestao: s ? { tipo: s.tipo, grupos: s.grupos.map((g) => g.flatMap((mid) => { const m = porId.get(mid); return m ? [resumo(m)] : []; })) } : null
        };
      }),
      total: total.rows[0]!.n, page: q.page, pageSize: q.pageSize
    };
  }));

  app.get("/financeiro/conciliacao/transacoes/:tid/candidatos", async (req) => runService(app, req, "ofx_imports.view", async (ctx) => {
    const { tid } = req.params as { tid: string };
    const t = await lerTransacao(ctx, tid);
    const q = candidatosQuery.parse(req.query);
    // Mesmo SINAL da transação (entrada casa com entrada), da conta da importação, confirmados e ainda livres — sob a RLS.
    const params: unknown[] = [ctx.orgId, t.contaId, D(t.valor).gt(0) ? "in" : "out"];
    const where = ["m.organization_id=$1", "m.bank_account_id=$2", "m.type=$3", "m.status='confirmed'", "m.reconciled_at is null", "m.deleted_at is null"];
    if (q.de) { params.push(q.de); where.push(`m.movement_date >= $${params.length}::date`); }
    if (q.ate) { params.push(q.ate); where.push(`m.movement_date <= $${params.length}::date`); }
    if (q.busca) { params.push(`%${escapeLike(q.busca)}%`); where.push(`(m.code ilike $${params.length} or m.note ilike $${params.length} or m.document ilike $${params.length})`); }
    where.push(...empresaScope(ctx, "m", params, { nullable: true, ignoreSelected: true }));
    const w = where.join(" and ");
    const total = await ctx.tx.query<{ n: number }>(`select count(*)::int as n from erp.bank_movements m where ${w}`, params);
    // Os mais próximos da data do extrato primeiro.
    const r = await ctx.tx.query<Record<string, unknown>>(
      `select m.id, m.code as codigo, to_char(m.movement_date,'YYYY-MM-DD') as data, ${VALOR_COM_SINAL}::text as valor, m.note as observacao, m.document as documento, m.empresa_id
         from erp.bank_movements m where ${w}
        order by abs(m.movement_date - $${params.length + 1}::date), m.movement_date, length(m.code), m.code, m.id limit ${q.pageSize} offset ${offset(q)}`, [...params, t.data]);
    // O movimento bancário tem ID Global: a grade do "vincular à mão" mostra o número (um lote, sem N+1).
    return { transacao: { id: t.id, data: t.data, valor: money(t.valor), memo: t.memo, situacao: t.situacao }, itens: await anexarIdsGlobais(ctx, "bank_movements", r.rows), total: total.rows[0]!.n, page: q.page, pageSize: q.pageSize };
  }));

  app.post("/financeiro/conciliacao/transacoes/:tid/confirmar", async (req) => runService(app, req, "ofx_imports.reconcile", async (ctx) => {
    const { tid } = req.params as { tid: string };
    const t = await lerTransacao(ctx, tid);
    const d = confirmarSchema.parse(req.body);
    const ids = d.movimento_ids.map((x) => x.toLowerCase());
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "confirmar_conciliacao", tid: t.id, movimentos: [...ids].sort(), actorId: ctx.user.id },
      () => vincularMovimentos(ctx, t.id, ids))).result;
  }));

  app.post("/financeiro/conciliacao/transacoes/:tid/criar-lancamento", async (req, reply) => reply.status(201).send(await runService(app, req, "ofx_imports.reconcile", async (ctx) => {
    requirePermission(ctx, "bank_movements.create");
    const { tid } = req.params as { tid: string };
    const visivel = await lerTransacao(ctx, tid);
    const d = criarLancamentoSchema.parse(req.body);
    await exigirEmpresaDeLancamento(ctx, d.empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "criar_lancamento_ofx", tid: visivel.id, ...d, empresa_id: d.empresa_id.toLowerCase(), actorId: ctx.user.id }, async () => {
      const t = await lerTransacao(ctx, visivel.id, { travar: true });
      if (t.situacao !== "pending") throw err("CONFLICT", MENSAGEM_TRANSACAO_RESOLVIDA);
      const movimentoId = await createBankMovement(ctx, {
        empresaId: d.empresa_id, bankAccountId: t.contaId, date: t.data, type: D(t.valor).gt(0) ? "in" : "out", amount: money(D(t.valor).abs()),
        note: d.observacao || t.memo || "Lançamento pelo extrato", sourceType: "ofx", sourceId: t.id,
        apportionment: d.rateio.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, percentage: a.percentage, amount: a.amount }))
      });
      await audit(ctx.tx, ctx, "bank_movements", movimentoId, "create", { origem: "ofx", transacao: t.id });
      await vincularMovimentos(ctx, t.id, [movimentoId]);
      return { movimento_id: movimentoId };
    })).result;
  })));

  app.post("/financeiro/conciliacao/transacoes/:tid/ignorar", async (req) => runService(app, req, "ofx_imports.reconcile", async (ctx) => {
    const { tid } = req.params as { tid: string };
    const t = await lerTransacao(ctx, tid);
    const d = ignorarSchema.parse(req.body ?? {});
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "ignorar_transacao_ofx", tid: t.id, motivo: d.motivo ?? null, actorId: ctx.user.id },
      () => ignorarTransacao(ctx, t.id, d.motivo ?? null))).result;
  }));

  app.post("/financeiro/conciliacao/transacoes/:tid/desfazer", async (req) => runService(app, req, "ofx_imports.reconcile", async (ctx) => {
    const { tid } = req.params as { tid: string };
    const t = await lerTransacao(ctx, tid);
    const d = desfazerSchema.parse(req.body);
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "desfazer_conciliacao_ofx", tid: t.id, motivo: d.motivo, actorId: ctx.user.id },
      () => desfazerConciliacao(ctx, t.id, d.motivo))).result;
  }));

  // ---------- Fluxo e resultado ----------
  app.get("/financeiro/fluxo", async (req) => runService(app, req, "cash_flow.view", async (ctx) => {
    const q = fluxoQuery.parse(req.query);
    if (q.previstos === "1") throw validation("Os previstos chegam com a provisão pela TOP", [{ path: ["previstos"], message: "Os previstos chegam com a provisão pela TOP" }]);
    const porOrganizacao = !q.empresa_id && q.agrupar_por !== "empresa";
    // Ler movimentos exige a capacidade deles; o fluxo da ORGANIZAÇÃO soma todas as empresas da conta e exige também
    // a capacidade de organização (a mesma porta do saldo).
    requirePermission(ctx, "bank_movements.view");
    if (porOrganizacao) requirePermission(ctx, "bank_accounts.view");
    const { de, ate } = await intervalo(ctx, q.de, q.ate);
    const direcoes = (["receivable", "payable"] as const).filter((dir) => hasPermission(ctx, permOf(dir, "view")));
    return montarFluxo(ctx, { de, ate, agrupamento: q.agrupamento, contas: q.contas ?? null, empresaId: q.empresa_id ?? null, agruparPor: q.agrupar_por, direcoes });
  }));

  app.get("/financeiro/resultado", async (req) => runService(app, req, "report.dre.view", async (ctx) => {
    const q = resultadoQuery.parse(req.query);
    const { de, ate } = await intervalo(ctx, q.de, q.ate);
    return montarResultado(ctx, { de, ate, regime: q.regime, empresaId: q.empresa_id ?? null });
  }));

  // ---------- Adiantamentos ----------
  app.get("/financeiro/adiantamentos", async (req) => runService(app, req, null, async (ctx0) => {
    const q = adiantamentosQuery.parse(req.query);
    const { ctx, direcoes } = await porDirecoes(ctx0, q.direcao);
    const params: unknown[] = [ctx.orgId, direcoes];
    const where = ["t.organization_id=$1", "t.deleted_at is null", "t.status<>'cancelled'", "t.direction = any($2::text[])", EH_ADIANTAMENTO];
    if (q.pessoa_id) { params.push(q.pessoa_id); where.push(`t.person_id=$${params.length}`); }
    if (q.empresa_id) { params.push(q.empresa_id); where.push(`t.empresa_id=$${params.length}`); }
    where.push(...empresaScope(ctx, "t", params, { ignoreSelected: true }));
    params.push(q.pageSize, offset(q));
    const r = await ctx.tx.query<{ total: number; itens: Record<string, unknown>[] }>(
      `with a as (select t.direction, t.person_id, t.empresa_id, t.paid_amount, ${USADO_DO_ADIANTAMENTO} as usado from erp.financial_titles t where ${where.join(" and ")}),
            g as (select a.direction, a.person_id, a.empresa_id, sum(a.paid_amount) as adiantado, sum(a.usado) as usado, sum(a.paid_amount - a.usado) as saldo, count(*)::int as quantidade
                    from a group by 1, 2, 3 ${q.so_com_saldo === "1" ? "having sum(a.paid_amount - a.usado) > 0" : ""})
       select (select count(*) from g)::int as total,
              coalesce((select json_agg((to_jsonb(x) - 'ordem') order by x.ordem) from (
                 select g.direction as direcao, g.person_id as pessoa_id, p.name as pessoa_nome, g.empresa_id, e.name as empresa_nome,
                        g.adiantado::text as adiantado, g.usado::text as usado, g.saldo::text as saldo, g.quantidade,
                        row_number() over (order by p.name nulls last, e.name, g.direction, g.person_id, g.empresa_id) as ordem
                   from g left join erp.people p on p.id=g.person_id and p.organization_id=$1 join erp.empresas e on e.id=g.empresa_id
                  order by p.name nulls last, e.name, g.direction, g.person_id, g.empresa_id limit $${params.length - 1} offset $${params.length}) x), '[]'::json) as itens`, params);
    const x = r.rows[0]!;
    return { itens: x.itens, total: x.total, page: q.page, pageSize: q.pageSize, direcoes };
  }));

  app.get("/financeiro/adiantamentos/titulos", async (req) => runService(app, req, null, async (ctx0) => {
    const q = titulosDeAdiantamentoQuery.parse(req.query);
    const { ctx } = await porDirecoes(ctx0, q.direcao);
    const params: unknown[] = [ctx.orgId, q.direcao];
    const where = ["t.organization_id=$1", "t.deleted_at is null", "t.status<>'cancelled'", "t.direction=$2", EH_ADIANTAMENTO];
    if (q.pessoa_id) { params.push(q.pessoa_id); where.push(`t.person_id=$${params.length}`); }
    if (q.empresa_id) { params.push(q.empresa_id); where.push(`t.empresa_id=$${params.length}`); }
    where.push(...empresaScope(ctx, "t", params, { ignoreSelected: true }));
    params.push(q.pageSize, offset(q));
    const r = await ctx.tx.query<{ total: number; itens: Record<string, unknown>[] }>(
      `with a as (select t.id, t.code, t.number, t.emission_date, t.person_id, t.empresa_id, t.paid_amount, ${USADO_DO_ADIANTAMENTO} as usado
                    from erp.financial_titles t where ${where.join(" and ")}),
            c as (select a.* from a where a.paid_amount - a.usado > 0)
       select (select count(*) from c)::int as total,
              coalesce((select json_agg(x order by x.emissao, x.codigo, x.id) from (
                 select c.id, c.code as codigo, c.number as numero, to_char(c.emission_date,'YYYY-MM-DD') as emissao, c.person_id as pessoa_id, c.empresa_id,
                        c.paid_amount::text as pago, c.usado::text as usado, (c.paid_amount - c.usado)::text as credito_disponivel
                   from c order by c.emission_date, c.code, c.id limit $${params.length - 1} offset $${params.length}) x), '[]'::json) as itens`, params);
    const x = r.rows[0]!;
    // Cada linha é um título: o ID Global vai junto (um lote, sem N+1).
    return { itens: await anexarIdsGlobais(ctx, "financial_titles", x.itens), total: x.total, page: q.page, pageSize: q.pageSize };
  }));

  // ---------- Naturezas padrão da baixa ----------
  app.get("/financeiro/configuracoes/naturezas-padrao", async (req) => runService(app, req, "financial_categories.view", (ctx) => naturezasPadraoDaOrganizacao(ctx)));

  app.put("/financeiro/configuracoes/naturezas-padrao", async (req) => runService(app, req, "financial_categories.edit", async (ctx) => {
    const d = naturezasPadraoSchema.parse(req.body);
    const enviadas = NATUREZAS_PADRAO.filter((n) => d[n.chave] !== undefined);
    // Cada id não nulo: natureza DESTA organização, viva, ATIVA, ANALÍTICA e do tipo que o componente pede (`both`
    // serve a qualquer um). Uma consulta para todos; a recusa é por campo, com a mesma mensagem para inexistente, de
    // outra organização, excluída, inativa, sintética ou de tipo errado.
    const valores = enviadas.map((n) => d[n.chave]?.toLowerCase() ?? null);
    const ids = [...new Set(valores.filter((x): x is string => x !== null))];
    const nat = ids.length
      ? (await ctx.tx.query<{ id: string; nature: string }>("select id, nature from erp.financial_categories where organization_id=$1 and id = any($2::uuid[]) and deleted_at is null and is_active and kind='analytic' for share", [ctx.orgId, ids])).rows
      : [];
    const tipoDe = new Map(nat.map((n) => [n.id, n.nature]));
    const invalidos = enviadas.filter((n, i) => {
      const id = valores[i];
      if (!id) return false;
      const tipo = tipoDe.get(id);
      return !(tipo === "both" || tipo === NATUREZA_ESPERADA[n.chave]);
    });
    if (invalidos.length) {
      throw validation(`Natureza inválida para ${invalidos[0]!.rotulo}`, invalidos.map((n) => ({ path: [n.chave], message: `Natureza inválida para ${n.rotulo}` })));
    }
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), { action: "naturezas_padrao_baixa", valores: Object.fromEntries(enviadas.map((n, i) => [n.chave, valores[i]])), actorId: ctx.user.id }, async () => {
      const antes = await naturezasPadraoDaOrganizacao(ctx);
      const colunas = enviadas.map((n) => n.chave);
      const atualizar = [...colunas.map((c) => `${c}=excluded.${c}`), "updated_by=excluded.updated_by"];
      const r = await ctx.tx.query<{ id: string }>(
        `insert into erp.financeiro_naturezas_padrao(organization_id, updated_by${colunas.map((c) => `, ${c}`).join("")})
         values ($1, $2${colunas.map((_, i) => `, $${i + 3}`).join("")})
         on conflict (organization_id) do update set ${atualizar.join(", ")} returning id`, [ctx.orgId, ctx.user.id, ...valores]);
      if (r.rowCount !== 1) throw naoEncontrada("Configuração");
      const depois = await naturezasPadraoDaOrganizacao(ctx);
      await audit(ctx.tx, ctx, "financeiro_naturezas_padrao", r.rows[0]!.id, "update", { campos: colunas }, { before: antes, after: depois });
      return depois;
    })).result;
  }));
}
