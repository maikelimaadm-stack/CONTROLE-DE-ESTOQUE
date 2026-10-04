import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0042 (OPERACOES-01 F8, Central Financeira, decisão 285), PROVADA CONTRA O BANCO — COMO O RUNNER APLICA.
 *
 * Antes de aplicar (DB-1, DB-2): a trava (2026,76) ocupada, o lock_timeout de 2s e CADA pré-condição P1–P8 quebrada
 * numa transação desfeita, cada uma com a SUA mensagem "OPERACOES-01 F8: …" — "já aplicada" antes de todas; a P8 (o
 * acervo de baixas confirmadas com desconto) com os ids no diagnóstico. Depois (DB-3): o ledger com 42, a reaplicação
 * recusada e as pós-condições (só de CATÁLOGO), cada uma quebrada numa transação desfeita com a sua mensagem.
 *
 * O que ela promete (DB-4), sempre com a premissa junto da conclusão:
 *   (a) a semântica B da baixa: o desconto conta UMA vez — título 100, baixa amount 100 discount 10 quita o título
 *       (antes da 0042 a mesma baixa estourava: 110 > 100);
 *   (b) movimento confirmado não muda valor, data, conta, tipo, empresa nem rótulo — nem pelo dono; conciliar,
 *       anotar e cancelar continuam; o cancelado não é guardado (é o desenho);
 *   (c) o crédito do adiantamento: o uso confere parceiro, empresa, direção, adiantamento vivo (por payment_type OU
 *       pelo is_advance do tipo) e crédito suficiente; a recusa de "não é seu" é a MESMA NOT_FOUND;
 *   (d) histórico sem DELETE: o papel da aplicação não apaga nem trunca o ledger e não reescreve o rateio do
 *       movimento (42501);
 *   (e) a tabela nova: uma linha por organização, RLS por tenant, FK composta para a natureza, auditoria;
 *   (f) os CHECKs do rótulo da transferência e do componente da baixa;
 *   (g) a porta do extrato: sem as duas capacidades, 42501; com elas, os confirmados com reconciled_at RECORTADOS pelo
 *       escopo de empresa no módulo financeiro (decisão do Maike de 03/10) — sem escopo, nada;
 *   (i) a conta COMPARTILHADA por A e B (e um movimento sem empresa): o escopo [A] recebe só as linhas de A (nenhum id,
 *       texto, documento ou valor de B, nem o sem empresa) e a soma de A; o escopo total, tudo e a soma total; o
 *       módulo é o FINANCEIRO fixo — "todas" em outro módulo e a GUC de outro módulo (ou nenhuma) não alargam nada;
 *   (h) as FKs compostas recusam referência de outra organização (23503).
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de RLS,
 * com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let contaBB: string; let contaCaixa: string;
let fornecedor: string; let outroFornecedor: string;
let natDespesa: string; let natReceita: string; let centro: string;
let tipoBoleto: string; let tipoAdFornecedor: string;
let outraOrg: string; let empresaOutraOrg: string; let natOutraOrg: string; let contaOutraOrg: string; let pessoaOutraOrg: string;
let usuarioSoContas: string; let usuarioContasEMovimentos: string;
let usuarioEscopoA: string; let usuarioEscopoTotal: string;

const ALVO = "0042_central_financeira.sql";
const M = "OPERACOES-01 F8: ";

/** As mensagens das pré-condições (ASCII, uma linha, prefixo da fatia). */
const TRAVA = `${M}outra transacao ja detem a trava desta migration (2026,76). Nada foi aplicado.`;
const JA = `${M}a 0042 ja foi aplicada ou ha schema divergente (financeiro_naturezas_padrao/lote_id/tipo_transferencia ja existe).`;
const PAPEL = `${M}papel erp_app ausente (0007); os privilegios da tabela nova e do ledger nao teriam destinatario.`;
const BYPASS = `${M}o papel que aplica a migration (dono da funcao SECURITY DEFINER do extrato) nao atravessa RLS; o acervo e o extrato seriam lidos pelo recorte dele.`;
const COLUNA = `${M}coluna lida pela migration ausente (financial_titles: id/organization_id/empresa_id/direction/person_id/title_type_id/payment_type/amount/discount/paid_amount/status/deleted_at/source_type/source_id/version; title_settlements: id/organization_id/title_id/settlement_kind/cross_title_id/bank_movement_id/amount/discount/status; bank_movements: id/organization_id/bank_account_id/movement_date/type/category_type/destination_account_id/amount/interest/empresa_id/status/reconciled_at/ofx_transaction_id/note/document/source_type/created_at/deleted_at/code; bank_accounts: id/organization_id/code/opening_balance/deleted_at; title_types: id/is_advance; financial_categories: id/organization_id/parent_id/nature/classification); a cadeia de migrations esta fora de ordem.`;
const CHAVE = `${M}chave alvo das FKs compostas ausente (uq_financial_categories_tenant de erp.financial_categories).`;
const FUNCOES = `${M}funcoes de RLS/auditoria/usuario/baixa/escopo ausentes (tenant_visible, audit_row, current_org_id, effective_user_id, has_permission, refresh_title_status, title_settlement_changed, set_updated_at, escopo_empresa_total, empresas_do_membro).`;
const gatilhos = (ts: string, bm: string, ft: string) =>
  `${M}gatilhos do ledger diferentes dos esperados (title_settlements: trg_settlement_changed; bank_movements: trg_bm_audit; financial_titles: trg_ft_audit, trg_ft_updated): title_settlements=${ts} bank_movements=${bm} financial_titles=${ft}`;
const ACERVO = `${M}ha baixa confirmada com desconto (a contagem do desconto muda nesta migration): `;

/** As mensagens de NEGÓCIO dos gatilhos (com acento e código conhecido: é o que o fromPgError entrega). */
const IMUTAVEL = "CONFLICT: Movimento bancário confirmado não se altera: estorne e lance outro.";
const ADT_NAO_ENCONTRADO = "NOT_FOUND: Adiantamento não encontrado";
const creditoInsuficiente = (disponivel: string, pedido: string) =>
  `PAYMENT_EXCEEDS_BALANCE: crédito do adiantamento insuficiente (disponível ${disponivel}, pedido ${pedido})`;

/** As 18 colunas novas nas tabelas de hoje (tabela, coluna, tipo do catálogo). */
const COLUNAS_NOVAS: [string, string, string][] = [
  ["bank_accounts", "data_saldo_inicial", "date"],
  ["financial_titles", "data_competencia", "date"], ["financial_titles", "conta_prevista_id", "uuid"], ["financial_titles", "cancel_reason", "text"],
  ["financial_titles", "cancelled_at", "timestamp with time zone"], ["financial_titles", "cancelled_by", "uuid"],
  ["title_settlements", "lote_id", "uuid"], ["title_settlements", "tarifa", "numeric(18,2)"], ["title_settlements", "adiantamento_id", "uuid"],
  ["title_settlements", "natureza_desconto_id", "uuid"],
  ["bank_movements", "tipo_transferencia", "text"], ["bank_movements", "title_settlement_id", "uuid"], ["bank_movements", "componente_baixa", "text"],
  ["bank_movements", "lote_baixa_id", "uuid"], ["bank_movements", "cancel_reason", "text"], ["bank_movements", "cancelled_at", "timestamp with time zone"],
  ["bank_movements", "cancelled_by", "uuid"],
  ["financial_categories", "grupo_dre", "text"]
];
const LEDGER = ["erp.financial_titles", "erp.title_settlements", "erp.bank_movements", "erp.bank_movement_apportionments"];

let seq = 0;
const id1 = async (q: Queryable, sql: string, p: unknown[] = []) => (await q.query<{ id: string }>(sql, p)).rows[0]!.id;
const sqlDa0042 = () => listMigrations().find((x) => x.name === ALVO)!.sql;

async function aplicar(): Promise<void> {
  const m = listMigrations().find((x) => x.name === ALVO);
  expect(m, `${ALVO} precisa existir`).toBeTruthy();
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(m!.sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [m!.name]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
/** Roda `sql` (a 0042, ou um trecho dela) numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a recusa, e o SQL aplicou");
}
const recusaDa0042 = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(sqlDa0042(), antes);
interface ErroPg { code?: string; constraint?: string; message: string }
async function erroDe(p: Promise<unknown>): Promise<ErroPg> {
  try { await p; } catch (e) { return e as ErroPg; }
  throw new Error("esperava recusa, e o banco aceitou");
}
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
/** Os objetos que a 0042 cria — todos ausentes antes, todos presentes depois. */
const objetos = async () => (await db.query<{ tabela: string | null; lote: boolean; tipo: boolean; extrato: string | null; credito: string | null; imutavel: string | null }>(
  `select to_regclass('erp.financeiro_naturezas_padrao')::text tabela,
          exists (select 1 from information_schema.columns where table_schema='erp' and table_name='title_settlements' and column_name='lote_id') lote,
          exists (select 1 from information_schema.columns where table_schema='erp' and table_name='bank_movements' and column_name='tipo_transferencia') tipo,
          to_regprocedure('erp.extrato_conta_organizacao(uuid[],date,date)')::text extrato,
          to_regprocedure('erp.baixa_credito_conferir()')::text credito,
          to_regprocedure('erp.bank_movements_confirmado_imutavel()')::text imutavel`)).rows[0]!;
const NENHUM_OBJETO = { tabela: null, lote: false, tipo: false, extrato: null, credito: null, imutavel: null };
const corpoDoRefresh = async () => (await db.query<{ d: string }>("select pg_get_functiondef('erp.refresh_title_status(uuid)'::regprocedure) d")).rows[0]!.d;

const ctxFin = (userId: string | null = demo.adminUserId, orgId: string = demo.orgId): TenantContext => ({ orgId, userId, modulo: "financeiro" });

type Direcao = "payable" | "receivable";
interface NovoTitulo { direcao?: Direcao; valor?: string; desconto?: string; pessoa?: string; empresa?: string; pagamento?: string; tipo?: string | null; org?: string }
/** Título aberto (superusuário: o cenário), com as colunas que a API de hoje grava. */
async function titulo(q: Queryable, o: NovoTitulo = {}): Promise<string> {
  seq += 1;
  return id1(q,
    `insert into erp.financial_titles (organization_id, empresa_id, code, direction, number, person_id, payment_type, title_type_id, amount, discount, emission_date, due_date)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-10-01','2026-10-31') returning id`,
    [o.org ?? demo.orgId, o.empresa ?? A, `F8-${seq}`, o.direcao ?? "payable", `NF-F8-${seq}`, o.pessoa ?? fornecedor, o.pagamento ?? "single",
     o.tipo === undefined ? tipoBoleto : o.tipo, o.valor ?? "100.00", o.desconto ?? "0"]);
}
interface NovoMovimento { conta?: string; valor?: string; tipo?: "in" | "out"; categoria?: string; empresa?: string | null; status?: string; org?: string; tipoTransferencia?: string | null }
async function movimento(q: Queryable, o: NovoMovimento = {}): Promise<string> {
  seq += 1;
  return id1(q,
    `insert into erp.bank_movements (organization_id, code, bank_account_id, movement_date, type, category_type, amount, empresa_id, status)
     values ($1,$2,$3,'2026-10-05',$4,$5,$6,$7,$8) returning id`,
    [o.org ?? demo.orgId, `F8M-${seq}`, o.conta ?? contaBB, o.tipo ?? "out", o.categoria ?? o.tipo ?? "out", o.valor ?? "100.00",
     o.empresa === undefined ? A : o.empresa, o.status ?? "confirmed"]);
}
interface NovaBaixa { titulo: string; valor: string; desconto?: string; tipo?: string; conta?: string | null; movimento?: string | null; adiantamento?: string | null; status?: string; org?: string }
/**
 * Baixa pelo `q` dado (superusuário ou transação da aplicação): o INSERT de hoje — o mesmo conjunto de colunas que a API
 * anterior grava, e que vale também ANTES da 0042 — e, só quando pedido, a coluna nova adiantamento_id.
 */
async function baixa(q: Queryable, o: NovaBaixa): Promise<string> {
  const p: unknown[] = [o.org ?? demo.orgId, o.titulo, o.tipo ?? (o.adiantamento ? "advance_compensation" : "bank_movement"), o.conta === undefined ? null : o.conta,
    o.movimento ?? null, o.valor, o.desconto ?? "0", o.status ?? "confirmed"];
  const comAdiantamento = o.adiantamento !== undefined && o.adiantamento !== null;
  if (comAdiantamento) p.push(o.adiantamento);
  return id1(q,
    `insert into erp.title_settlements (organization_id, title_id, settlement_date, settlement_kind, bank_account_id, bank_movement_id, amount, discount, net_amount, status${comAdiantamento ? ", adiantamento_id" : ""})
     values ($1,$2,'2026-10-05',$3,$4,$5,$6,$7,$6,$8${comAdiantamento ? ",$9" : ""}) returning id`, p);
}
/** Paga o título inteiro por um movimento (superusuário), como a baixa de hoje faz. */
async function pagar(tituloId: string, valor: string, direcao: Direcao = "payable", org = demo.orgId, conta = contaBB, empresa: string | null = A): Promise<void> {
  const mv = await movimento(db, { org, conta, valor, tipo: direcao === "payable" ? "out" : "in", empresa });
  await baixa(db, { org, titulo: tituloId, valor, conta, movimento: mv });
}
const estado = async (id: string) => (await db.query<{ status: string; paid_amount: string; balance: string }>(
  "select status, paid_amount, balance from erp.financial_titles where id=$1", [id])).rows[0]!;

/**
 * O escopo de empresa do membro NUM módulo (superusuário: o cenário): "todas" ou as empresas nomeadas — a mesma forma
 * que a borda de administração grava (erp.membro_escopos_empresa + erp.membro_empresas). Sem chamar: nenhuma empresa.
 */
async function escopo(usuario: string, modulo: string, empresas: "todas" | string[], org = demo.orgId): Promise<void> {
  const m = await id1(db, "select id from erp.organization_members where organization_id=$1 and user_id=$2", [org, usuario]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,$3,$4)", [org, m, modulo, empresas === "todas" ? "todas" : "selecionadas"]);
  if (empresas !== "todas") {
    for (const e of empresas) await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,$3,'selecionadas',$4)", [org, m, modulo, e]);
  }
}

async function membro(org: string, rotulo: string, permissoes: string[]): Promise<string> {
  const usuario = await id1(db, "insert into erp.users (email, name, password_hash) values ($1,$2,'x') returning id", [`${rotulo}@demo.local`, `F8 ${rotulo}`]);
  const papel = await id1(db, "insert into erp.roles (organization_id, name) values ($1,$2) returning id", [org, `F8 ${rotulo}`]);
  for (const p of permissoes) await db.query("insert into erp.role_permissions (role_id, permission_key) values ($1,$2)", [papel, p]);
  await db.query("insert into erp.organization_members (organization_id, user_id, role_id, is_owner, is_active) values ($1,$2,$3,false,true)", [org, usuario, papel]);
  return usuario;
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0042")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });

  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  contaBB = await id1(db, "select id from erp.bank_accounts where organization_id=$1 and code='BB'", [demo.orgId]);
  contaCaixa = await id1(db, "select id from erp.bank_accounts where organization_id=$1 and code='CXF'", [demo.orgId]);
  fornecedor = await id1(db, "insert into erp.people (organization_id, code, name, is_provider) values ($1,'F8-F1','[TEST] Fornecedor F8',true) returning id", [demo.orgId]);
  outroFornecedor = await id1(db, "insert into erp.people (organization_id, code, name, is_provider) values ($1,'F8-F2','[TEST] Outro fornecedor F8',true) returning id", [demo.orgId]);
  natDespesa = await id1(db, "insert into erp.financial_categories (organization_id, code, name, nature, kind) values ($1,'F8.D','[TEST] Juros pagos F8','expense','analytic') returning id", [demo.orgId]);
  natReceita = await id1(db, "insert into erp.financial_categories (organization_id, code, name, nature, kind) values ($1,'F8.R','[TEST] Juros recebidos F8','income','analytic') returning id", [demo.orgId]);
  centro = await id1(db, "select id from erp.cost_centers where organization_id=$1 order by code limit 1", [demo.orgId]);
  tipoBoleto = await id1(db, "select id from erp.title_types where organization_id is null and name='Boleto'");
  tipoAdFornecedor = await id1(db, "select id from erp.title_types where organization_id is null and name='Ad.Fornecedor' and is_advance");

  outraOrg = await id1(db, "insert into erp.organizations (name, slug) values ('[TEST] Outra F8','outra-f8') returning id");
  empresaOutraOrg = await id1(db, "insert into erp.empresas (organization_id, code, name) values ($1, 94, '[TEST] Empresa outra org F8') returning id", [outraOrg]);
  natOutraOrg = await id1(db, "insert into erp.financial_categories (organization_id, code, name, nature, kind) values ($1,'F8.X','[TEST] Natureza outra org','expense','analytic') returning id", [outraOrg]);
  contaOutraOrg = await id1(db, "insert into erp.bank_accounts (organization_id, code, description, type) values ($1,'F8X','[TEST] Conta outra org','checking') returning id", [outraOrg]);
  pessoaOutraOrg = await id1(db, "insert into erp.people (organization_id, code, name, is_provider) values ($1,'F8-X','[TEST] Fornecedor outra org',true) returning id", [outraOrg]);

  // Sem escopo de empresa nenhum no financeiro (fail-closed): pela RLS, não vê movimento com empresa.
  usuarioSoContas = await membro(demo.orgId, "f8-contas", ["bank_accounts.view"]);
  usuarioContasEMovimentos = await membro(demo.orgId, "f8-contas-movimentos", ["bank_accounts.view", "bank_movements.view"]);
  // As duas capacidades e o financeiro só na empresa A — com "todas" no ESTOQUE (outro módulo não pode alargar o extrato).
  usuarioEscopoA = await membro(demo.orgId, "f8-escopo-a", ["bank_accounts.view", "bank_movements.view"]);
  await escopo(usuarioEscopoA, "financeiro", [A]);
  await escopo(usuarioEscopoA, "estoque", "todas");
  // As duas capacidades e o financeiro em "todas": o escopo TOTAL sem ser proprietário.
  usuarioEscopoTotal = await membro(demo.orgId, "f8-escopo-total", ["bank_accounts.view", "bank_movements.view"]);
  await escopo(usuarioEscopoTotal, "financeiro", "todas");
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("DB-1/DB-2 — a 0042 sobre o banco até a 0041: trava, lock_timeout e pré-condições", () => {
  it("DB-0 PREMISSA: o ledger tem 41 e a 0042 não está nele; os objetos não existem; a soma de hoje conta o desconto DUAS vezes", async () => {
    expect(await noLedger()).toBe(false);
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 41, ultima: "0041_regras_gerais_e_aprovacao_da_top.sql" });
    expect(await objetos()).toEqual(NENHUM_OBJETO);
    expect(await corpoDoRefresh()).toContain("sum(amount + discount)");
    // A soma de hoje: título 100, baixa amount 100 discount 10 → 110 > 100, estoura (numa transação desfeita).
    const e = await recusaDe("select 1", async (c) => {
      const t = await titulo(c, { valor: "100.00" });
      await baixa(c, { titulo: t, valor: "100.00", desconto: "10.00", conta: contaBB });
    });
    expect(e).toBe("PAYMENT_EXCEEDS_BALANCE: baixas 110.00 excedem líquido 100.00");
    // O papel da aplicação ainda apaga o ledger: é o que a 0042 tira.
    for (const t of LEDGER) expect([t, (await db.query<{ d: boolean }>("select has_table_privilege('erp_app', $1, 'delete') d", [t])).rows[0]!.d]).toEqual([t, true]);
    expect(A).not.toBe(B);
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.permissions where key in ('bank_accounts.view','bank_movements.view')")).rows[0]!.n).toBe(2);
  });

  it("DB-1.1 trava (2026,76) em uso por outra sessão: a 0042 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 76)");
      await expect(aplicar()).rejects.toThrow(TRAVA);
    } finally { await outra.query("select pg_advisory_unlock(2026, 76)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await objetos()).toEqual(NENHUM_OBJETO);
  });

  it("DB-1.2 lock_timeout 2s: uma escrita aberta em erp.bank_accounts (a primeira tabela alterada) faz a 0042 desistir em ~2s, sem efeito", async () => {
    const escritor = await db.connect();
    try {
      await escritor.query("begin");
      // RowExclusive na conta: o ADD COLUMN precisa de AccessExclusive, e os dois não convivem.
      await escritor.query("update erp.bank_accounts set code = code where id is null");
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await escritor.query("rollback"); escritor.release(); }
    expect(await noLedger()).toBe(false);
    expect(await objetos()).toEqual(NENHUM_OBJETO);
  });

  it("DB-2 reversas: cada pré-condição quebrada recusa a 0042 com a SUA mensagem, sem efeito", async () => {
    // P1 "já aplicada": a tabela nova, a coluna lote_id ou a coluna tipo_transferencia.
    expect(await recusaDa0042((c) => c.query("create table erp.financeiro_naturezas_padrao (id int)"))).toBe(JA);
    expect(await recusaDa0042((c) => c.query("alter table erp.title_settlements add column lote_id uuid"))).toBe(JA);
    expect(await recusaDa0042((c) => c.query("alter table erp.bank_movements add column tipo_transferencia text"))).toBe(JA);
    // "Já aplicada" vem ANTES de todas: com uma coluna, um gatilho, a chave alvo e o papel quebrados JUNTO, o motivo
    // dito é o verdadeiro.
    expect(await recusaDa0042(async (c) => {
      await c.query("alter table erp.title_settlements rename column amount to amount_f8");
      await c.query("drop trigger trg_bm_audit on erp.bank_movements");
      await c.query("alter table erp.financial_categories rename constraint uq_financial_categories_tenant to uq_f8");
      await c.query("alter table erp.bank_movements add column tipo_transferencia text");
      await c.query("set local role erp_app");
    })).toBe(JA);
    // P2 sem o papel da aplicação.
    expect(await recusaDa0042((c) => c.query("alter role erp_app rename to erp_app_f8"))).toBe(PAPEL);
    // P3 quem aplica não atravessa RLS (o papel da aplicação).
    expect(await recusaDa0042((c) => c.query("set local role erp_app"))).toBe(BYPASS);
    // P4 cada coluna lida (55), uma de cada vez.
    const colunas: [string, string][] = [
      ...["id", "organization_id", "empresa_id", "direction", "person_id", "title_type_id", "payment_type", "amount", "discount", "paid_amount", "status",
        "deleted_at", "source_type", "source_id", "version"].map((c): [string, string] => ["financial_titles", c]),
      ...["id", "organization_id", "title_id", "settlement_kind", "cross_title_id", "bank_movement_id", "amount", "discount", "status"]
        .map((c): [string, string] => ["title_settlements", c]),
      ...["id", "organization_id", "bank_account_id", "movement_date", "type", "category_type", "destination_account_id", "amount", "interest", "empresa_id",
        "status", "reconciled_at", "ofx_transaction_id", "note", "document", "source_type", "created_at", "deleted_at", "code"].map((c): [string, string] => ["bank_movements", c]),
      ...["id", "organization_id", "code", "opening_balance", "deleted_at"].map((c): [string, string] => ["bank_accounts", c]),
      ...["id", "is_advance"].map((c): [string, string] => ["title_types", c]),
      ...["id", "organization_id", "parent_id", "nature", "classification"].map((c): [string, string] => ["financial_categories", c])
    ];
    expect(colunas).toHaveLength(55);
    for (const [tabela, coluna] of colunas) {
      expect([tabela, coluna, await recusaDa0042((c) => c.query(`alter table erp.${tabela} rename column ${coluna} to ${coluna}_f8`))]).toEqual([tabela, coluna, COLUNA]);
    }
    // P5 a chave alvo das FKs compostas para a natureza.
    expect(await recusaDa0042((c) => c.query("alter table erp.financial_categories rename constraint uq_financial_categories_tenant to uq_f8"))).toBe(CHAVE);
    // P6 cada função chamada.
    for (const fn of ["tenant_visible(uuid)", "audit_row()", "current_org_id()", "effective_user_id()", "has_permission(uuid, uuid, text)",
      "refresh_title_status(uuid)", "title_settlement_changed()", "set_updated_at()", "escopo_empresa_total(text)", "empresas_do_membro(text)"]) {
      expect([fn, await recusaDa0042((c) => c.query(`alter function erp.${fn} rename to f8_renomeada`))]).toEqual([fn, FUNCOES]);
    }
    // P7 o conjunto EXATO dos gatilhos do ledger: um a menos em cada tabela, um a mais.
    const TS = "{trg_settlement_changed}"; const BM = "{trg_bm_audit}"; const FT = "{trg_ft_audit,trg_ft_updated}";
    expect(await recusaDa0042((c) => c.query("drop trigger trg_bm_audit on erp.bank_movements"))).toBe(gatilhos(TS, "<NULL>", FT));
    expect(await recusaDa0042((c) => c.query("drop trigger trg_ft_updated on erp.financial_titles"))).toBe(gatilhos(TS, BM, "{trg_ft_audit}"));
    expect(await recusaDa0042((c) => c.query("drop trigger trg_settlement_changed on erp.title_settlements"))).toBe(gatilhos("<NULL>", BM, FT));
    expect(await recusaDa0042((c) => c.query("create trigger trg_ts_zz after insert on erp.title_settlements for each row execute function erp.title_settlement_changed()")))
      .toBe(gatilhos("{trg_settlement_changed,trg_ts_zz}", BM, FT));
    // P8 o acervo: a baixa CONFIRMADA com desconto para a migration, com o id; a confirmada sem desconto e a
    // cancelada com desconto não entram (o filtro é o certo).
    let comDesconto = ""; let outraComDesconto = "";
    const msg = await recusaDa0042(async (c) => {
      const t = await titulo(c, { valor: "1000.00" });
      comDesconto = await baixa(c, { titulo: t, valor: "100.00", desconto: "10.00", conta: contaBB });
      outraComDesconto = await baixa(c, { titulo: t, valor: "50.00", desconto: "1.00", conta: contaBB });
      await baixa(c, { titulo: t, valor: "200.00", conta: contaBB });
      await baixa(c, { titulo: t, valor: "20.00", desconto: "5.00", conta: contaBB, status: "cancelled" });
    });
    expect(msg).toBe(ACERVO + [comDesconto, outraComDesconto].sort().join(", "));
    // Nada ficou: o ledger, os objetos e a soma de hoje são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await objetos()).toEqual(NENHUM_OBJETO);
    expect(await corpoDoRefresh()).toContain("sum(amount + discount)");
    expect((await db.query("select 1 from pg_roles where rolname='erp_app'")).rowCount).toBe(1);
  });
});

describe("DB-3 — a 0042 aplica; reaplicar e as pós-condições", () => {
  it("DB-3.1 aplica: ledger com 42 (a 0042 por último NESTE banco), 49 no repositório, objetos criados e trava liberada", async () => {
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: 42, ultima: ALVO });
    const noDisco = listMigrations().map((m) => m.name);
    // O ledger DESTE banco termina na 0042 (ele sobe só até ela); no repositório a 0043 (F5a), a 0044 (F6a), a 0045 (F9), a
    // 0046 (F10), a 0047 (F7), a 0048 (F12) e a 0049 (MAPA-01) vêm depois.
    expect(noDisco.length, "53 migrations no repositório (0001..0053)").toBe(53);
    expect(noDisco[41]).toBe(ALVO);
    expect(await objetos()).toEqual({
      tabela: "erp.financeiro_naturezas_padrao", lote: true, tipo: true, extrato: "erp.extrato_conta_organizacao(uuid[],date,date)",
      credito: "erp.baixa_credito_conferir()", imutavel: "erp.bank_movements_confirmado_imutavel()"
    });
    // A trava é de transação: depois do commit, outra sessão a obtém.
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 76) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("DB-3.2 reaplicar é recusado pela pré-condição 'já aplicada', sem efeito", async () => {
    expect(await recusaDa0042()).toBe(JA);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n).toBe(1);
  });

  it("DB-3.3 catálogo: as 18 colunas novas anuláveis e sem default, e TODA coluna nova (e a tabela e as funções novas) comentada", async () => {
    const r = (await db.query<{ c: string }>(
      `select e.tabela || '.' || e.coluna || ':' || format_type(a.atttypid, a.atttypmod) || ':' || (not a.attnotnull) || ':' || a.atthasdef
              || ':' || (col_description(a.attrelid, a.attnum) is not null) c
         from unnest($1::text[], $2::text[]) e(tabela, coluna)
         join pg_attribute a on a.attrelid = ('erp.' || e.tabela)::regclass and a.attname = e.coluna and a.attnum > 0 and not a.attisdropped
        `, [COLUNAS_NOVAS.map((x) => x[0]), COLUNAS_NOVAS.map((x) => x[1])])).rows.map((x) => x.c);
    // Ordenadas aqui, não no banco: a ordenação do banco segue a collation, a do teste não.
    expect(r.sort()).toEqual(COLUNAS_NOVAS.map(([t, c, tipo]) => `${t}.${c}:${tipo}:true:false:true`).sort());
    const semComentario = (await db.query<{ c: string }>(
      `select coalesce(a.attname, '(tabela)') c from pg_class c
         left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where c.oid = 'erp.financeiro_naturezas_padrao'::regclass
          and (case when a.attname is null then obj_description(c.oid, 'pg_class') else col_description(c.oid, a.attnum) end) is null`)).rows;
    expect(semComentario).toEqual([]);
    expect((await db.query<{ n: number }>("select count(*)::int n from pg_attribute where attrelid = 'erp.financeiro_naturezas_padrao'::regclass and attnum > 0 and not attisdropped")).rows[0]!.n,
      "a conta acima varreu as 13 colunas").toBe(13);
    const fns = (await db.query<{ n: number }>(
      `select count(*)::int n from unnest(array['erp.extrato_conta_organizacao(uuid[],date,date)', 'erp.baixa_credito_conferir()', 'erp.bank_movements_confirmado_imutavel()']) f(x)
        where obj_description(x::regprocedure, 'pg_proc') is not null`)).rows[0]!.n;
    expect(fns).toBe(3);
  });

  /**
   * As PÓS-CONDIÇÕES só leem OBJETOS (catálogo), nunca tabela viva — no deploy a tabela viva tem o dado de produção.
   * E cada uma morde: o bloco delas (o trecho "8)" do arquivo, como está) roda de novo sobre o banco aplicado, com UM
   * objeto quebrado numa transação desfeita, e recusa com a SUA mensagem.
   */
  it("DB-3.4 pós-condições: só de catálogo (nenhum FROM/JOIN em tabela do erp), e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const sql = sqlDa0042();
    const inicio = sql.indexOf("-- ---------- 8) pós-condições");
    expect(inicio, "o trecho 8) existe").toBeGreaterThan(0);
    const pos = sql.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    // Contraprova: sobre o banco aplicado, o bloco passa.
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const COLUNAS = `${M}colunas novas ausentes, de outro tipo, obrigatorias ou com default (esperadas 18 anulaveis sem default).`;
    const TABELA = `${M}erp.financeiro_naturezas_padrao ausente ou fora do contrato (13 colunas).`;
    const RLS = `${M}erp.financeiro_naturezas_padrao sem RLS habilitada e forcada, ou com politica diferente de tenant_isolation (uma so).`;
    const UNICAS = `${M}chaves unicas (id, organization_id) de bank_accounts/financial_titles/title_settlements ou (organization_id) de financeiro_naturezas_padrao ausentes ou fora da forma.`;
    const FKS = `${M}FKs compostas novas ausentes ou fora da forma (coluna, organization_id) -> alvo (id, organization_id), sem cascata (esperadas 13).`;
    const FK_USUARIO = `${M}FKs de cancelled_by (financial_titles, bank_movements) para erp.users ausentes ou com cascata.`;
    const CHECKS = `${M}CHECKs novos (tarifa, adiantamento, tipo_transferencia, componente_baixa, grupo_dre) incompletos (esperados 5).`;
    const INDICES = `${M}indices parciais novos ausentes (conta_prevista, lote, adiantamento, title_settlement, lote_baixa, ofx_transaction; esperados 6).`;
    const GATILHOS = `${M}gatilhos de title_settlements/bank_movements/financeiro_naturezas_padrao ausentes, a mais, desligados, de outro tipo, sem WHEN ou na funcao errada (esperados exatamente 6).`;
    const FN_GATILHO = `${M}funcoes de gatilho novas fora da forma (sem SECURITY DEFINER, search_path "erp, pg_temp", EXECUTE so do dono).`;
    const EXTRATO = `${M}erp.extrato_conta_organizacao fora da forma (SECURITY DEFINER estavel, search_path "erp, pg_catalog", EXECUTE do erp_app e nao de PUBLIC).`;
    const EXTRATO_ESCOPO = `${M}erp.extrato_conta_organizacao sem o recorte pelo escopo de empresa do modulo financeiro (escopo_empresa_total e empresas_do_membro no WHERE).`;
    const REFRESH = `${M}erp.refresh_title_status fora da semantica B (sum(amount), sem amount + discount) ou sem EXECUTE do erp_app.`;
    const PRIVILEGIOS = `${M}privilegios do erp_app errados (sem delete/truncate no ledger e na tabela nova, sem update no rateio do movimento, select/insert/update na tabela nova).`;
    // O corpo da 0004, como está no repositório: a soma que conta o desconto de novo.
    const refresh0004 = /create or replace function erp\.refresh_title_status[\s\S]*?end \$\$;/.exec(listMigrations().find((x) => x.name.startsWith("0004_"))!.sql)?.[0];
    expect(refresh0004, "o corpo da 0004 foi encontrado").toContain("sum(amount + discount)");
    // A porta do extrato COMO ESTÁ na 0042, e duas versões dela que entregam outra empresa: sem o predicado no WHERE (o
    // corpo de antes do conserto de 03/10) e com o módulo da GUC no lugar do financeiro fixo (a rota de conta abre a
    // transação sem módulo: a união das empresas do membro em qualquer módulo).
    const extrato0042 = /create function erp\.extrato_conta_organizacao[\s\S]*?end \$\$;/.exec(sql)?.[0];
    const PREDICADO = "       and (v_total or m.empresa_id in (select erp.empresas_do_membro('financeiro')))\n";
    expect(extrato0042, "o corpo da porta foi encontrado, com o predicado").toContain(PREDICADO);
    const extratoSemRecorte = extrato0042!.replace("create function", "create or replace function").replace(PREDICADO, "");
    const extratoPeloModuloDaGuc = extrato0042!.replace("create function", "create or replace function").replaceAll("'financeiro'", "erp.modulo_empresa_atual()");
    expect(extratoSemRecorte).not.toContain("empresas_do_membro('financeiro')");
    expect(extratoPeloModuloDaGuc).not.toContain("'financeiro'");

    const casos: [string, string, string][] = [
      ["coluna nova com default", "alter table erp.bank_accounts alter column data_saldo_inicial set default current_date", COLUNAS],
      ["coluna nova de outro tipo", "alter table erp.title_settlements alter column tarifa type numeric(18,4)", COLUNAS],
      ["coluna nova obrigatória", "update erp.financial_categories set grupo_dre = 'despesas'; alter table erp.financial_categories alter column grupo_dre set not null", COLUNAS],
      ["coluna nova ausente", "alter table erp.financial_titles drop column cancelled_by", COLUNAS],
      ["tabela nova com coluna a mais", "alter table erp.financeiro_naturezas_padrao add column f8_extra int", TABELA],
      ["RLS sem force", "alter table erp.financeiro_naturezas_padrao no force row level security", RLS],
      ["política a mais", "create policy f8_extra on erp.financeiro_naturezas_padrao for select using (true)", RLS],
      ["chave (id, organization_id) na ordem trocada", "alter table erp.bank_accounts drop constraint uq_bank_accounts_tenant cascade, add constraint uq_bank_accounts_tenant unique (organization_id, id)", UNICAS],
      ["duas linhas por organização", "alter table erp.financeiro_naturezas_padrao drop constraint uq_financeiro_naturezas_padrao_org", UNICAS],
      ["FK composta em cascata", "alter table erp.financeiro_naturezas_padrao drop constraint fk_fnp_tarifa_bancaria, add constraint fk_fnp_tarifa_bancaria foreign key (tarifa_bancaria_id, organization_id) references erp.financial_categories (id, organization_id) on delete cascade", FKS],
      ["FK de coluna única", "alter table erp.title_settlements drop constraint fk_title_settlements_adiantamento, add constraint fk_title_settlements_adiantamento foreign key (adiantamento_id) references erp.financial_titles (id)", FKS],
      ["FK não validada", "alter table erp.bank_movements drop constraint fk_bank_movements_title_settlement, add constraint fk_bank_movements_title_settlement foreign key (title_settlement_id, organization_id) references erp.title_settlements (id, organization_id) not valid", FKS],
      ["FK da trilha com ação", "alter table erp.bank_movements drop constraint fk_bank_movements_cancelled_by, add constraint fk_bank_movements_cancelled_by foreign key (cancelled_by) references erp.users (id) on delete set null", FK_USUARIO],
      ["CHECK ausente", "alter table erp.bank_movements drop constraint chk_bank_movements_componente_baixa", CHECKS],
      ["índice ausente", "drop index erp.idx_title_settlements_lote", INDICES],
      ["índice inteiro (não parcial)", "drop index erp.idx_bank_movements_ofx_transaction; create index idx_bank_movements_ofx_transaction on erp.bank_movements (ofx_transaction_id)", INDICES],
      ["imutabilidade desligada", "alter table erp.bank_movements disable trigger trg_bm_confirmado_imutavel", GATILHOS],
      ["imutabilidade olhando só o valor", "drop trigger trg_bm_confirmado_imutavel on erp.bank_movements; create trigger trg_bm_confirmado_imutavel before update of amount on erp.bank_movements for each row when (old.status = 'confirmed' and old.amount is distinct from new.amount) execute function erp.bank_movements_confirmado_imutavel()", GATILHOS],
      ["crédito sem WHEN", "drop trigger trg_ts_credito_conferir on erp.title_settlements; create trigger trg_ts_credito_conferir before insert on erp.title_settlements for each row execute function erp.baixa_credito_conferir()", GATILHOS],
      ["crédito depois (AFTER)", "drop trigger trg_ts_credito_conferir on erp.title_settlements; create trigger trg_ts_credito_conferir after insert on erp.title_settlements for each row when (new.adiantamento_id is not null) execute function erp.baixa_credito_conferir()", GATILHOS],
      ["um sétimo gatilho", "create trigger trg_bm_zz before insert on erp.bank_movements for each row execute function erp.bank_movements_confirmado_imutavel()", GATILHOS],
      ["auditoria da tabela nova ausente", "drop trigger trg_fnp_audit on erp.financeiro_naturezas_padrao", GATILHOS],
      ["função de gatilho com EXECUTE do erp_app", "grant execute on function erp.baixa_credito_conferir() to erp_app", FN_GATILHO],
      ["função de gatilho definer", "alter function erp.bank_movements_confirmado_imutavel() security definer", FN_GATILHO],
      ["extrato executável por PUBLIC", "grant execute on function erp.extrato_conta_organizacao(uuid[], date, date) to public", EXTRATO],
      ["extrato invoker", "alter function erp.extrato_conta_organizacao(uuid[], date, date) security invoker", EXTRATO],
      ["extrato com search_path aberto", "alter function erp.extrato_conta_organizacao(uuid[], date, date) set search_path = erp, public", EXTRATO],
      ["extrato sem o recorte de empresa (o corpo de antes do conserto)", extratoSemRecorte, EXTRATO_ESCOPO],
      ["extrato pelo módulo da GUC (e não pelo financeiro)", extratoPeloModuloDaGuc, EXTRATO_ESCOPO],
      ["refresh contando o desconto de novo (o corpo da 0004)", refresh0004!, REFRESH],
      ["refresh sem EXECUTE do erp_app", "revoke execute on function erp.refresh_title_status(uuid) from public, erp_app", REFRESH],
      ["DELETE de volta no ledger", "grant delete on erp.title_settlements to erp_app", PRIVILEGIOS],
      ["UPDATE no rateio do movimento", "grant update on erp.bank_movement_apportionments to erp_app", PRIVILEGIOS],
      ["TRUNCATE na tabela nova", "grant truncate on erp.financeiro_naturezas_padrao to erp_app", PRIVILEGIOS],
      ["sem UPDATE na tabela nova", "revoke update on erp.financeiro_naturezas_padrao from erp_app", PRIVILEGIOS]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => t.query(sabotagem))]).toEqual([nome, mensagem]);
    }
    // Nada ficou: a soma B, a imutabilidade e os privilégios são os da migration.
    expect(await corpoDoRefresh()).toContain("sum(amount)");
    expect(await corpoDoRefresh()).not.toContain("amount + discount");
    expect((await db.query<{ d: boolean }>("select has_table_privilege('erp_app', 'erp.title_settlements', 'delete') d")).rows[0]!.d).toBe(false);
  });
});

describe("DB-4 — o comportamento da 0042", () => {
  it("DB-4a semântica B: o desconto conta UMA vez — título 100, baixa amount 100 discount 10 quita; parcial e estouro como antes", async () => {
    const t = await titulo(db, { valor: "100.00" });
    expect(await estado(t), "premissa: aberto, saldo 100").toEqual({ status: "open", paid_amount: "0.00", balance: "100.00" });
    // Pelo papel da aplicação, como a API grava (o gatilho de hoje chama a soma nova).
    await withTx(app, ctxFin(), (tx) => baixa(tx, { titulo: t, valor: "100.00", desconto: "10.00", conta: contaBB }));
    expect(await estado(t)).toEqual({ status: "paid", paid_amount: "100.00", balance: "0.00" });

    const p = await titulo(db, { valor: "100.00" });
    await withTx(app, ctxFin(), (tx) => baixa(tx, { titulo: p, valor: "50.00", desconto: "5.00", conta: contaBB }));
    expect(await estado(p), "o desconto não quita a mais").toEqual({ status: "partially_paid", paid_amount: "50.00", balance: "50.00" });
    await withTx(app, ctxFin(), (tx) => baixa(tx, { titulo: p, valor: "50.00", conta: contaBB }));
    expect(await estado(p)).toEqual({ status: "paid", paid_amount: "100.00", balance: "0.00" });
    expect((await erroDe(withTx(app, ctxFin(), (tx) => baixa(tx, { titulo: p, valor: "0.01", conta: contaBB })))).message)
      .toBe("PAYMENT_EXCEEDS_BALANCE: baixas 100.01 excedem líquido 100.00");
    // O desconto do TÍTULO continua fora do líquido (net = amount − discount): título 100 com desconto 10 quita com 90.
    const d = await titulo(db, { valor: "100.00", desconto: "10.00" });
    await withTx(app, ctxFin(), (tx) => baixa(tx, { titulo: d, valor: "90.00", conta: contaBB }));
    expect(await estado(d)).toEqual({ status: "paid", paid_amount: "90.00", balance: "0.00" });
    // A API chama a função direto (financial.ts): o papel da aplicação continua executando.
    await expect(withTx(app, ctxFin(), (tx) => tx.query("select erp.refresh_title_status($1)", [d]))).resolves.toBeTruthy();
  });

  it("DB-4b movimento confirmado é imutável em valor, data, conta, tipo, empresa e rótulo — nem o dono muda; conciliar, anotar e cancelar continuam", async () => {
    const mv = await movimento(db, { valor: "100.00" });
    const naApp = (set: string, p: unknown[] = []) => withTx(app, ctxFin(), (tx) => tx.query(`update erp.bank_movements set ${set} where id=$1`, [mv, ...p]));
    for (const [nome, set, p] of [
      ["valor", "amount = 101", []], ["data", "movement_date = '2026-10-06'", []], ["juros", "interest = 1", []], ["conta", "bank_account_id = $2", [contaCaixa]],
      ["tipo", "type = 'in', category_type = 'in'", []], ["empresa", "empresa_id = $2", [B]],
      ["rótulo da transferência", "category_type = 'internal_transfer', tipo_transferencia = 'transferencia'", []],
      ["cancelar e mudar o valor no MESMO comando", "status = 'cancelled', amount = 50", []]
    ] as [string, string, unknown[]][]) {
      expect([nome, (await erroDe(naApp(set, p))).message]).toEqual([nome, IMUTAVEL]);
    }
    // Nem o dono (superusuário): o gatilho vale para todos.
    expect((await erroDe(db.query("update erp.bank_movements set amount = 999 where id=$1", [mv]))).message).toBe(IMUTAVEL);
    expect((await db.query("select amount, movement_date, status from erp.bank_movements where id=$1", [mv])).rows)
      .toEqual([{ amount: "100.00", movement_date: "2026-10-05", status: "confirmed" }]);
    // Repetir o MESMO valor não é mudança; conciliar, anotar e cancelar passam (ROW COUNT 1 — visível e atualizado).
    for (const [set, p] of [["amount = 100", []], ["note = 'conferido', document = 'DOC-1'", []], ["reconciled_at = now()", []], ["reconciled_at = null", []],
      ["cancel_reason = 'lançado em dobro', cancelled_at = now(), cancelled_by = $2, status = 'cancelled'", [demo.adminUserId]]] as [string, unknown[]][]) {
      expect([set, (await naApp(set, p)).rowCount]).toEqual([set, 1]);
    }
    // O CANCELADO não é guardado (old.status <> 'confirmed'): é o desenho — a correção já foi estorno + movimento novo.
    expect((await naApp("amount = 80")).rowCount).toBe(1);
    expect((await db.query("select amount, status, note, cancel_reason from erp.bank_movements where id=$1", [mv])).rows)
      .toEqual([{ amount: "80.00", status: "cancelled", note: "conferido", cancel_reason: "lançado em dobro" }]);
  });

  it("DB-4c crédito do adiantamento: usa até o crédito (o igual passa), recusa o excedente, e 'não é seu' é a MESMA NOT_FOUND", async () => {
    const adt = await titulo(db, { valor: "100.00", pagamento: "advance" });
    await pagar(adt, "100.00");
    expect(await estado(adt), "premissa: adiantamento pago (crédito 100)").toEqual({ status: "paid", paid_amount: "100.00", balance: "0.00" });
    const t1 = await titulo(db, { valor: "200.00" });
    const usar = (tituloId: string, adiantamento: string, valor: string, ctx: TenantContext = ctxFin()) =>
      withTx(app, ctx, (tx) => baixa(tx, { titulo: tituloId, adiantamento, valor }));

    const uso60 = await usar(t1, adt, "60.00");
    expect(await estado(t1)).toEqual({ status: "partially_paid", paid_amount: "60.00", balance: "140.00" });
    expect((await erroDe(usar(t1, adt, "50.00"))).message).toBe(creditoInsuficiente("40.00", "50.00"));
    await usar(t1, adt, "40.00");
    expect(await estado(t1), "o igual ao crédito passa").toEqual({ status: "partially_paid", paid_amount: "100.00", balance: "100.00" });
    expect((await erroDe(usar(t1, adt, "0.01"))).message).toBe(creditoInsuficiente("0.00", "0.01"));
    // Só uso CONFIRMADO consome crédito: estornado o de 60, os 60 voltam.
    await db.query("update erp.title_settlements set status='cancelled', cancelled_at=now(), cancel_reason='teste' where id=$1", [uso60]);
    await usar(t1, adt, "60.00");
    expect(await estado(t1)).toEqual({ status: "partially_paid", paid_amount: "100.00", balance: "100.00" });

    // Adiantamento pelo TIPO do título (is_advance), com payment_type de hoje: o crédito é lido (o defeito "is_advance não é lido").
    const adtTipo = await titulo(db, { valor: "30.00", pagamento: "single", tipo: tipoAdFornecedor });
    await pagar(adtTipo, "30.00");
    await usar(t1, adtTipo, "30.00");
    expect(await estado(t1)).toEqual({ status: "partially_paid", paid_amount: "130.00", balance: "70.00" });

    // Cada "não é seu", com crédito sobrando (a única diferença é a condição em teste): a MESMA NOT_FOUND.
    const comCredito = async (o: NovoTitulo, pagarComo: Direcao = "payable", empresa: string | null = A) => {
      const id = await titulo(db, { valor: "50.00", ...o });
      await pagar(id, "50.00", pagarComo, o.org ?? demo.orgId, o.org ? contaOutraOrg : contaBB, empresa);
      return id;
    };
    const casos: [string, () => Promise<string>][] = [
      ["outro parceiro", () => comCredito({ pagamento: "advance", pessoa: outroFornecedor })],
      ["outra empresa", () => comCredito({ pagamento: "advance", empresa: B }, "payable", B)],
      ["outra direção (a receber)", () => comCredito({ pagamento: "advance", direcao: "receivable" }, "receivable")],
      ["não é adiantamento (boleto)", () => comCredito({ pagamento: "single" })],
      ["cancelado", async () => { const id = await comCredito({ pagamento: "advance" }); await db.query("update erp.financial_titles set status='cancelled' where id=$1", [id]); return id; }],
      ["excluído", async () => { const id = await comCredito({ pagamento: "advance" }); await db.query("update erp.financial_titles set deleted_at=now() where id=$1", [id]); return id; }],
      ["inexistente", async () => "00000000-0000-4000-8000-0000000000f8"],
      ["de outra organização (a RLS o esconde)", () => comCredito({ pagamento: "advance", org: outraOrg, empresa: empresaOutraOrg, pessoa: pessoaOutraOrg }, "payable", empresaOutraOrg)]
    ];
    for (const [nome, criar] of casos) {
      const outro = await criar();
      expect([nome, (await erroDe(usar(t1, outro, "10.00"))).message]).toEqual([nome, ADT_NAO_ENCONTRADO]);
    }
    // O superusuário enxerga o de outra organização (sem RLS): a conferência de organização é do gatilho, não da RLS.
    const deOutraOrg = await comCredito({ pagamento: "advance", org: outraOrg, empresa: empresaOutraOrg, pessoa: pessoaOutraOrg }, "payable", empresaOutraOrg);
    expect((await erroDe(baixa(db, { titulo: t1, adiantamento: deOutraOrg, valor: "10.00" }))).message).toBe(ADT_NAO_ENCONTRADO);
    // Nenhuma das recusas gravou: o título está como estava.
    expect(await estado(t1)).toEqual({ status: "partially_paid", paid_amount: "130.00", balance: "70.00" });
    // O CHECK: adiantamento só em compensação sem banco (o gatilho passa — o crédito existe —, e o CHECK recusa).
    const adtCheck = await comCredito({ pagamento: "advance" });
    const e = await erroDe(withTx(app, ctxFin(), (tx) => baixa(tx, { titulo: t1, adiantamento: adtCheck, valor: "10.00", tipo: "bank_movement", conta: contaBB })));
    expect([e.code, e.constraint]).toEqual(["23514", "chk_title_settlements_adiantamento"]);
  });

  it("DB-4d histórico sem DELETE: o papel da aplicação não apaga nem trunca o ledger e não reescreve o rateio do movimento (42501); as linhas ficam", async () => {
    const t = await titulo(db, { valor: "10.00" });
    const mv = await movimento(db, { valor: "10.00" });
    const s = await baixa(db, { titulo: t, valor: "10.00", conta: contaBB, movimento: mv });
    const ap = await id1(db, "insert into erp.bank_movement_apportionments (movement_id, financial_category_id, cost_center_id, percentage, amount) values ($1,$2,$3,100,10) returning id", [mv, natDespesa, centro]);
    const comandos: [string, string, unknown[]][] = [
      ["erp.financial_titles", "delete from erp.financial_titles where id=$1", [t]],
      ["erp.title_settlements", "delete from erp.title_settlements where id=$1", [s]],
      ["erp.bank_movements", "delete from erp.bank_movements where id=$1", [mv]],
      ["erp.bank_movement_apportionments", "delete from erp.bank_movement_apportionments where id=$1", [ap]],
      ["erp.bank_movement_apportionments", "update erp.bank_movement_apportionments set amount = 9 where id=$1", [ap]],
      ...LEDGER.map((tabela): [string, string, unknown[]] => [tabela, `truncate ${tabela}`, []])
    ];
    for (const [tabela, sql, p] of comandos) {
      expect([tabela, sql, (await erroDe(withTx(app, ctxFin(), (tx) => tx.query(sql, p)))).code]).toEqual([tabela, sql, "42501"]);
    }
    expect((await db.query<{ n: number }>(
      `select ((select count(*) from erp.financial_titles where id=$1) + (select count(*) from erp.title_settlements where id=$2)
            + (select count(*) from erp.bank_movements where id=$3) + (select count(*) from erp.bank_movement_apportionments where id=$4 and amount = 10))::int n`,
      [t, s, mv, ap])).rows[0]!.n).toBe(4);
    // Contraprova: o papel continua lendo e gravando o ledger (o INSERT do rateio passa), e o rateio do TÍTULO
    // continua com DELETE (o PUT do título aberto troca o rateio).
    const ins = await withTx(app, ctxFin(), (tx) => tx.query("insert into erp.bank_movement_apportionments (movement_id, financial_category_id, cost_center_id, percentage, amount) values ($1,$2,$3,100,10)", [mv, natDespesa, centro]));
    expect(ins.rowCount).toBe(1);
    expect((await db.query<{ d: boolean }>("select has_table_privilege('erp_app', 'erp.title_apportionments', 'delete') d")).rows[0]!.d).toBe(true);
  });

  it("DB-4e a tabela nova: uma linha por organização, RLS por tenant, FK composta para a natureza, auditoria e updated_at", async () => {
    const minha = await id1(db, "insert into erp.financeiro_naturezas_padrao (organization_id, juros_pagos_id) values ($1,$2) returning id", [demo.orgId, natDespesa]);
    const alheia = await id1(db, "insert into erp.financeiro_naturezas_padrao (organization_id, juros_pagos_id) values ($1,$2) returning id", [outraOrg, natOutraOrg]);
    expect(minha).not.toBe(alheia);
    // Uma por organização.
    const dup = await erroDe(db.query("insert into erp.financeiro_naturezas_padrao (organization_id) values ($1)", [demo.orgId]));
    expect([dup.code, dup.constraint]).toEqual(["23505", "uq_financeiro_naturezas_padrao_org"]);
    // A organização A só lê a sua.
    const lidas = await withTx(app, ctxFin(), (tx) => tx.query<{ id: string; organization_id: string }>("select id, organization_id from erp.financeiro_naturezas_padrao"));
    expect(lidas.rows).toEqual([{ id: minha, organization_id: demo.orgId }]);
    // Upsert como a API faz (on conflict da organização), ROW COUNT 1; a linha da outra não é alcançada (0); a outra
    // organização no INSERT viola a política (42501); DELETE não é privilégio do papel (42501).
    const antes = (await db.query<{ u: string }>("select updated_at::text u from erp.financeiro_naturezas_padrao where id=$1", [minha])).rows[0]!.u;
    const up = await withTx(app, ctxFin(), (tx) => tx.query(
      `insert into erp.financeiro_naturezas_padrao (organization_id, juros_recebidos_id, updated_by) values ($1,$2,$3)
       on conflict (organization_id) do update set juros_recebidos_id = excluded.juros_recebidos_id, updated_by = excluded.updated_by`, [demo.orgId, natReceita, demo.adminUserId]));
    expect(up.rowCount).toBe(1);
    expect((await withTx(app, ctxFin(), (tx) => tx.query("update erp.financeiro_naturezas_padrao set tarifa_bancaria_id = null where id=$1", [alheia]))).rowCount).toBe(0);
    expect((await erroDe(withTx(app, ctxFin(), (tx) => tx.query("insert into erp.financeiro_naturezas_padrao (organization_id) values ($1)", [outraOrg])))).code).toBe("42501");
    expect((await erroDe(withTx(app, ctxFin(), (tx) => tx.query("delete from erp.financeiro_naturezas_padrao where id=$1", [minha])))).code).toBe("42501");
    const depois = (await db.query<{ juros_pagos_id: string; juros_recebidos_id: string; updated_by: string; mudou: boolean }>(
      "select juros_pagos_id, juros_recebidos_id, updated_by, updated_at > $2::timestamptz mudou from erp.financeiro_naturezas_padrao where id=$1", [minha, antes])).rows[0];
    expect(depois).toEqual({ juros_pagos_id: natDespesa, juros_recebidos_id: natReceita, updated_by: demo.adminUserId, mudou: true });
    // A auditoria: o upsert virou um 'update' com o usuário da transação e o id da linha.
    expect((await db.query<{ action: string; user_id: string }>(
      "select action, user_id from erp.audit_logs where entity='financeiro_naturezas_padrao' and entity_id=$1 and user_id is not null order by id", [minha])).rows)
      .toEqual([{ action: "update", user_id: demo.adminUserId }]);
    // FK composta: natureza de OUTRA organização recusada (23503); a da própria passa.
    const fk = await erroDe(db.query("update erp.financeiro_naturezas_padrao set tarifa_bancaria_id=$2 where id=$1", [minha, natOutraOrg]));
    expect([fk.code, fk.constraint]).toEqual(["23503", "fk_fnp_tarifa_bancaria"]);
    expect((await db.query("update erp.financeiro_naturezas_padrao set tarifa_bancaria_id=$2 where id=$1", [minha, natDespesa])).rowCount).toBe(1);
  });

  it("DB-4f CHECKs: rótulo de transferência só em internal_transfer e da lista; componente da baixa só com a baixa ou o lote", async () => {
    const recusa = async (sql: string, p: unknown[]) => { const e = await erroDe(db.query(sql, p)); return [e.code, e.constraint]; };
    // O rótulo é gravado na CRIAÇÃO (num confirmado ele faz parte da imutabilidade, DB-4b): o CHECK se prova no INSERT.
    const comRotulo = (codigo: string, categoria: string, rotulo: string) => db.query(
      `insert into erp.bank_movements (organization_id, code, bank_account_id, movement_date, type, category_type, amount, empresa_id, tipo_transferencia)
       values ($1,$2,$3,'2026-10-05','out',$4,10,$5,$6)`, [demo.orgId, codigo, contaCaixa, categoria, A, rotulo]);
    const naoTransferencia = await erroDe(comRotulo("F8M-TR1", "out", "deposito"));
    expect([naoTransferencia.code, naoTransferencia.constraint]).toEqual(["23514", "chk_bank_movements_tipo_transferencia"]);
    const foraDaLista = await erroDe(comRotulo("F8M-TR2", "internal_transfer", "pix"));
    expect([foraDaLista.code, foraDaLista.constraint]).toEqual(["23514", "chk_bank_movements_tipo_transferencia"]);
    for (const rotulo of ["transferencia", "deposito", "saque", "aplicacao", "resgate"]) {
      expect([rotulo, (await comRotulo(`F8M-${rotulo}`, "internal_transfer", rotulo)).rowCount]).toEqual([rotulo, 1]);
    }
    const mvIn = await movimento(db, { tipo: "in", categoria: "in" });
    expect(await recusa("update erp.bank_movements set componente_baixa='juros' where id=$1", [mvIn])).toEqual(["23514", "chk_bank_movements_componente_baixa"]);
    expect(await recusa("update erp.bank_movements set componente_baixa='pix', lote_baixa_id=gen_random_uuid() where id=$1", [mvIn])).toEqual(["23514", "chk_bank_movements_componente_baixa"]);
    expect((await db.query("update erp.bank_movements set componente_baixa='tarifa', lote_baixa_id=gen_random_uuid() where id=$1", [mvIn])).rowCount).toBe(1);
    const t = await titulo(db, { valor: "10.00" });
    const s = await baixa(db, { titulo: t, valor: "10.00", conta: contaBB });
    expect((await db.query("update erp.bank_movements set componente_baixa='juros', lote_baixa_id=null, title_settlement_id=$2 where id=$1", [mvIn, s])).rowCount).toBe(1);
    expect(await recusa("update erp.title_settlements set tarifa = -1 where id=$1", [s])).toEqual(["23514", "chk_title_settlements_tarifa"]);
    expect(await recusa("update erp.financial_categories set grupo_dre='lucro' where id=$1", [natDespesa])).toEqual(["23514", "chk_financial_categories_grupo_dre"]);
    expect((await db.query("update erp.financial_categories set grupo_dre='despesas' where id=$1", [natDespesa])).rowCount).toBe(1);
  });

  it("DB-4g a porta do extrato: sem bank_movements.view → 42501; com as duas capacidades, os confirmados com reconciled_at RECORTADOS pelo escopo de empresa — sem escopo no financeiro, nada", async () => {
    const conciliado = await movimento(db, { valor: "11.00", tipo: "in" });
    await db.query("update erp.bank_movements set reconciled_at='2026-10-06T10:00:00Z' where id=$1", [conciliado]);
    const pendente = await movimento(db, { valor: "12.00", tipo: "out", empresa: B });
    const cancelado = await movimento(db, { valor: "13.00", status: "cancelled" });
    const alheio = await movimento(db, { org: outraOrg, conta: contaOutraOrg, empresa: empresaOutraOrg, valor: "14.00" });
    const extrato = (userId: string | null) => withTx(app, ctxFin(userId), (tx) => tx.query<{ id: string; account_code: string; code: string; amount: string; type: string; category_type: string; reconciled: boolean; empresa_id: string }>(
      `select id, account_code, code, amount, type, category_type, reconciled_at is not null reconciled, empresa_id
         from erp.extrato_conta_organizacao(null, '2026-10-01', '2026-10-31') where id = any($1::uuid[]) order by amount`, [[conciliado, pendente, cancelado, alheio]]));

    const semMov = await erroDe(extrato(usuarioSoContas));
    expect([semMov.code, semMov.message]).toEqual(["42501", "SEM_CAPACIDADE: extrato organizacional de conta exige bank_accounts.view e bank_movements.view"]);
    const semUsuario = await erroDe(extrato(null));
    expect([semUsuario.code, semUsuario.message]).toEqual(["42501", "CONTEXTO_AUSENTE: extrato de conta exige organizacao e usuario na transacao"]);
    // Premissa: os dois confirmados existem (um em cada empresa) — e, pela RLS, quem tem as duas capacidades mas nenhum
    // escopo de empresa no financeiro não os vê.
    expect((await db.query<{ empresa_id: string }>("select empresa_id from erp.bank_movements where id = any($1::uuid[]) and status='confirmed' order by amount", [[conciliado, pendente]])).rows)
      .toEqual([{ empresa_id: A }, { empresa_id: B }]);
    expect((await withTx(app, ctxFin(usuarioContasEMovimentos), (tx) => tx.query("select 1 from erp.bank_movements where id = any($1::uuid[])", [[conciliado, pendente]]))).rowCount).toBe(0);
    // A porta também não: módulo financeiro sem configuração é NENHUMA empresa (fail-closed), não "a organização".
    expect((await extrato(usuarioContasEMovimentos)).rows).toEqual([]);
    // O proprietário (escopo total): os confirmados das duas empresas, com a conciliação; nem o cancelado nem o de outra organização.
    const codigos = (await db.query<{ id: string; code: string }>("select id, code from erp.bank_movements where id = any($1::uuid[])", [[conciliado, pendente]])).rows;
    const codigo = (id: string) => codigos.find((x) => x.id === id)!.code;
    expect((await extrato(demo.adminUserId)).rows).toEqual([
      { id: conciliado, account_code: "BB", code: codigo(conciliado), amount: "11.00", type: "in", category_type: "in", reconciled: true, empresa_id: A },
      { id: pendente, account_code: "BB", code: codigo(pendente), amount: "12.00", type: "out", category_type: "out", reconciled: false, empresa_id: B }
    ]);
    // O filtro de conta e de período continua o da 0015.
    expect((await withTx(app, ctxFin(), (tx) => tx.query("select 1 from erp.extrato_conta_organizacao(array[$1]::uuid[], '2026-10-01', '2026-10-31') where id = any($2::uuid[])", [contaCaixa, [conciliado, pendente]]))).rowCount).toBe(0);
    expect((await withTx(app, ctxFin(), (tx) => tx.query("select 1 from erp.extrato_conta_organizacao(null, '2026-11-01', null) where id = any($1::uuid[])", [[conciliado, pendente]]))).rowCount).toBe(0);
    expect((await db.query<{ p: boolean }>("select has_function_privilege('public', 'erp.extrato_conta_organizacao(uuid[],date,date)', 'execute') p")).rows[0]!.p).toBe(false);
  });

  it("DB-4i conta COMPARTILHADA por A e B (e um sem empresa): o escopo [A] recebe só as linhas e a soma de A; o total, tudo e a soma total; o módulo é o financeiro FIXO", async () => {
    const conta = await id1(db, "insert into erp.bank_accounts (organization_id, code, description, type, opening_balance) values ($1,'F8CMP','[TEST] Conta compartilhada F8','checking',1000) returning id", [demo.orgId]);
    await db.query("insert into erp.bank_account_empresas (bank_account_id, empresa_id) values ($1,$2),($1,$3)", [conta, A, B]);
    const mov = (empresa: string | null, tipo: "in" | "out", valor: string, rotulo: string, status = "confirmed") => id1(db,
      `insert into erp.bank_movements (organization_id, code, bank_account_id, movement_date, type, category_type, amount, empresa_id, status, note, document)
       values ($1,$2,$3,'2026-10-07',$4,$4,$5,$6,$7,$8,$9) returning id`,
      [demo.orgId, `F8C-${rotulo}`, conta, tipo, valor, empresa, status, `[TEST] Lançamento ${rotulo}`, `DOC-${rotulo}`]);
    const a1 = await mov(A, "in", "100.00", "A1"); const a2 = await mov(A, "out", "30.00", "A2");
    const b1 = await mov(B, "in", "500.00", "B1"); const b2 = await mov(B, "out", "45.00", "B2");
    const n1 = await mov(null, "in", "9.00", "N1");
    await mov(A, "in", "1000.00", "AX", "cancelled");

    // PREMISSA: as linhas de B e a sem empresa EXISTEM na conta, com texto, documento e valor (o superusuário as lê).
    expect((await db.query<{ id: string; empresa_id: string | null; note: string; document: string; amount: string }>(
      "select id, empresa_id, note, document, amount from erp.bank_movements where bank_account_id=$1 and status='confirmed' order by code", [conta])).rows).toEqual([
      { id: a1, empresa_id: A, note: "[TEST] Lançamento A1", document: "DOC-A1", amount: "100.00" },
      { id: a2, empresa_id: A, note: "[TEST] Lançamento A2", document: "DOC-A2", amount: "30.00" },
      { id: b1, empresa_id: B, note: "[TEST] Lançamento B1", document: "DOC-B1", amount: "500.00" },
      { id: b2, empresa_id: B, note: "[TEST] Lançamento B2", document: "DOC-B2", amount: "45.00" },
      { id: n1, empresa_id: null, note: "[TEST] Lançamento N1", document: "DOC-N1", amount: "9.00" }
    ]);
    // PREMISSA do módulo fixo: sem módulo na transação (como a rota de conta abre), a RLS vale a UNIÃO dos módulos — o
    // "todas" do estoque abre B ao membro [A]; no financeiro, a RLS de leitura dá A e o sem empresa.
    const rls = (modulo: string | null) => withTx(app, { orgId: demo.orgId, userId: usuarioEscopoA, modulo }, (tx) =>
      tx.query<{ id: string }>("select id from erp.bank_movements where bank_account_id=$1 and status='confirmed' order by code", [conta]));
    expect((await rls(null)).rows.map((x) => x.id), "sem módulo: a união abre a conta inteira").toEqual([a1, a2, b1, b2, n1]);
    expect((await rls("financeiro")).rows.map((x) => x.id), "no financeiro: A e o sem empresa").toEqual([a1, a2, n1]);

    type Linha = { id: string; empresa_id: string | null; note: string; document: string; amount: string; type: string };
    const pela = (userId: string, modulo: string | null) => withTx(app, { orgId: demo.orgId, userId, modulo }, async (tx) => ({
      linhas: (await tx.query<Linha>("select id, empresa_id, note, document, amount, type from erp.extrato_conta_organizacao(array[$1]::uuid[], null, null) order by code", [conta])).rows,
      agregado: (await tx.query<{ n: number; saldo: string }>(
        "select count(*)::int n, coalesce(sum(case when type='in' then amount + interest else -(amount + interest) end),0)::text saldo from erp.extrato_conta_organizacao(array[$1]::uuid[], null, null)", [conta])).rows[0]!
    }));
    const linhaA = [
      { id: a1, empresa_id: A, note: "[TEST] Lançamento A1", document: "DOC-A1", amount: "100.00", type: "in" },
      { id: a2, empresa_id: A, note: "[TEST] Lançamento A2", document: "DOC-A2", amount: "30.00", type: "out" }
    ];
    // ESCOPO [A]: só as linhas de A e a soma de A (100 − 30 = 70) — sem módulo (a rota), no financeiro e com a GUC de
    // OUTRO módulo (o estoque, em que ele tem "todas"): o módulo da porta é o financeiro, fixo.
    for (const modulo of [null, "financeiro", "estoque"]) {
      const r = await pela(usuarioEscopoA, modulo);
      expect([modulo, r.linhas, r.agregado]).toEqual([modulo, linhaA, { n: 2, saldo: "70.00" }]);
      // Nada de B nem do sem empresa: nem id, nem texto, nem documento, nem valor.
      const tudo = JSON.stringify(r);
      for (const proibido of [b1, b2, n1, B, "B1", "B2", "N1", "500.00", "45.00", "9.00"]) expect([modulo, proibido, tudo.includes(proibido)]).toEqual([modulo, proibido, false]);
    }
    // ESCOPO TOTAL (modo "todas" no financeiro, sem ser proprietário) e o PROPRIETÁRIO: tudo, inclusive o sem empresa; a
    // soma total (70 + 455 + 9 = 534). O cancelado nunca.
    for (const [quem, usuario] of [["todas no financeiro", usuarioEscopoTotal], ["proprietário", demo.adminUserId]] as const) {
      const r = await pela(usuario, null);
      expect([quem, r.linhas.map((x) => x.id), r.agregado]).toEqual([quem, [a1, a2, b1, b2, n1], { n: 5, saldo: "534.00" }]);
    }
    // SEM ESCOPO no financeiro (só as capacidades): nada, e a soma zero — não "a organização".
    expect(await pela(usuarioContasEMovimentos, null)).toEqual({ linhas: [], agregado: { n: 0, saldo: "0" } });
  });

  it("DB-4h FKs compostas: conta prevista, natureza do desconto e baixa do componente de OUTRA organização são recusadas (23503); as da própria passam", async () => {
    const t = await titulo(db, { valor: "10.00" });
    const fk = async (sql: string, p: unknown[]) => { const e = await erroDe(db.query(sql, p)); return [e.code, e.constraint]; };
    expect(await fk("update erp.financial_titles set conta_prevista_id=$2 where id=$1", [t, contaOutraOrg])).toEqual(["23503", "fk_financial_titles_conta_prevista"]);
    expect((await db.query("update erp.financial_titles set conta_prevista_id=$2 where id=$1", [t, contaCaixa])).rowCount).toBe(1);
    const s = await baixa(db, { titulo: t, valor: "5.00", conta: contaBB });
    expect(await fk("update erp.title_settlements set natureza_desconto_id=$2 where id=$1", [s, natOutraOrg])).toEqual(["23503", "fk_title_settlements_natureza_desconto"]);
    expect((await db.query("update erp.title_settlements set natureza_desconto_id=$2 where id=$1", [s, natReceita])).rowCount).toBe(1);
    // A baixa de outra organização, apontada por um movimento desta.
    const tAlheio = await titulo(db, { org: outraOrg, empresa: empresaOutraOrg, pessoa: pessoaOutraOrg, valor: "10.00" });
    const sAlheia = await baixa(db, { org: outraOrg, titulo: tAlheio, valor: "10.00", conta: contaOutraOrg });
    const mv = await movimento(db, { valor: "1.00" });
    expect(await fk("update erp.bank_movements set title_settlement_id=$2, componente_baixa='juros' where id=$1", [mv, sAlheia])).toEqual(["23503", "fk_bank_movements_title_settlement"]);
    expect((await db.query("update erp.bank_movements set title_settlement_id=$2, componente_baixa='juros' where id=$1", [mv, s])).rowCount).toBe(1);
  });
});
