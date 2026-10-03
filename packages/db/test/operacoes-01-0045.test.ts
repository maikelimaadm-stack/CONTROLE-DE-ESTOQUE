import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0045 (OPERACOES-01 F9, financeiro pela TOP e LCDPR, decisão 286 — parte F9a), PROVADA CONTRA O BANCO — COMO O
 * RUNNER APLICA.
 *
 * Antes de aplicar (DB-0 a DB-2): a premissa (o ledger com todas as anteriores, os objetos ausentes, o 'previsto'
 * recusado pelo CHECK de hoje), a trava (2026,79) ocupada, o lock_timeout de 2s com uma escrita aberta no título e
 * CADA pré-condição P1–P10 quebrada numa transação desfeita, cada uma com a SUA mensagem "OPERACOES-01 F9: …" — "já
 * aplicada" antes de todas. Depois (DB-3): o ledger com a 0045 por último, os objetos e os comentários.
 *
 * O que ela promete (DB-4), sempre com a premissa junto da conclusão:
 *   (a) o título previsto: grava com origem de documento e nada pago; sem origem, avulso ('manual') ou pago → 23514;
 *   (b) o previsto só sai da previsão cancelado: virar aberto/pago, mudar valor, desconto, parceiro, empresa, direção
 *       ou origem → CONFLICT; aberto → previsto → CONFLICT; o vencimento e a observação continuam atualizáveis;
 *   (c) a baixa num previsto morre no banco (CONFLICT, pelo papel da aplicação); a baixa num aberto continua;
 *   (d) o imóvel do movimento é da EMPRESA do movimento (23503) e nunca vai sem empresa, em transferência entre contas
 *       ou em saldo inicial (23514); o da baixa é da organização (23503);
 *   (e) a TOP no título e no movimento: o par inteiro ou nada (23514), a versão DAQUELA TOP (23503);
 *   (f) os padrões da versão: algum padrão (23514), um por versão (23505), FKs compostas (23503), imutáveis para
 *       todos (CONFLICT nomeando a operação), o papel da aplicação sem update/delete/truncate (42501), só a organização
 *       vê os seus (RLS), auditoria;
 *   (g) o imóvel rural: um padrão vivo por empresa, um CIB vivo por empresa (23505), os CHECKs (23514), a FK composta
 *       da empresa (23503), a RLS por empresa no módulo financeiro (quem vê só B não vê nem grava em A), sem
 *       delete/truncate para o papel da aplicação (42501), auditoria e updated_at;
 *   (h) o tipo LCDPR da natureza: só os quatro valores (23514) ou nulo.
 * DB-5: as pós-condições (só de CATÁLOGO), cada uma quebrada numa transação desfeita, com a sua mensagem.
 * DB-6: reaplicar é recusado ("já aplicada"); a trava é liberada no commit.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de RLS,
 * com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let contaBB: string; let contaCaixa: string;
let cliente: string; let outroCliente: string;
let natReceita: string; let natDespesa: string; let centro: string;
let tipoBoleto: string; let formaSistema: string;
let outraOrg: string; let empresaOutraOrg: string; let natOutraOrg: string; let centroOutraOrg: string; let contaOutraOrg: string;
let usuarioSoB: string;

interface Top { top: string; versao: string }
let topA: Top; let topB: Top; let topOutraOrg: Top;

const ALVO = "0045_financeiro_pela_top_e_lcdpr.sql";
const M = "OPERACOES-01 F9: ";
/** As migrations ANTERIORES à 0045 no repositório (o banco deste teste sobe até elas, arquivo a arquivo). */
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);

/** As mensagens das pré-condições (ASCII, uma linha, prefixo da fatia). */
const TRAVA = `${M}outra transacao ja detem a trava desta migration (2026,79). Nada foi aplicado.`;
const JA = `${M}a 0045 ja foi aplicada ou ha schema divergente (imoveis_rurais/tipos_operacao_versao_financeiro/tipo_operacao_id/tipo_lcdpr/financial_titles_previsto_guarda ja existe).`;
const PAPEL = `${M}papel erp_app ausente (0007); os privilegios das tabelas novas nao teriam destinatario.`;
const BYPASS = `${M}o papel que aplica a migration nao atravessa RLS (e o papel da aplicacao ou outro sem bypass); as tabelas novas, os gatilhos e as constraints do ledger sao do dono do schema.`;
const COLUNA = `${M}coluna lida pela migration ausente (financial_titles: id/organization_id/empresa_id/direction/person_id/amount/discount/paid_amount/status/source_type/source_id/version; title_settlements: id/organization_id/title_id/amount/status; bank_movements: id/organization_id/empresa_id/category_type/movement_date; financial_categories, cost_centers, bank_accounts, title_types, payment_methods: id/organization_id; tipos_operacao_versoes: id/tipo_operacao_id/organization_id); a cadeia de migrations esta fora de ordem.`;
const CHAVE = `${M}chave alvo das FKs compostas ausente (uq_tipos_operacao_versoes_tenant da 0021, uq_financial_categories_tenant e uq_cost_centers_tenant da 0024, uq_bank_accounts_tenant da 0042).`;
const EMPRESAS = `${M}chave (organization_id, id) de erp.empresas ausente; a FK composta da empresa do imovel rural nao teria alvo.`;
const FUNCOES = `${M}funcoes de RLS/auditoria/baixa ausentes (tenant_visible, audit_row, set_updated_at, escopo_empresa_total, empresas_do_membro, modulo_empresa_atual, refresh_title_status, title_settlement_changed).`;
const MODULO = `${M}modulo de escopo empresarial financeiro ausente (0011); o imovel rural nao teria modulo.`;
const checkDeStatus = (def: string) =>
  `${M}o CHECK financial_titles_status_check de erp.financial_titles nao e o de hoje (open, partially_paid, paid, cancelled); a lista com previsto seria escrita sobre outra regra: ${def}`;
const gatilhosDoTitulo = (lista: string) => `${M}gatilhos de erp.financial_titles diferentes dos esperados (trg_ft_audit, trg_ft_updated): ${lista}`;
const REFRESH_DE_OUTRO = `${M}erp.refresh_title_status nao e a da 0042 (sum(amount), retorno no cancelado, sem previsto); a linha do previsto seria escrita sobre outro corpo.`;

/** O CHECK de situação de hoje e o de depois, como o banco os escreve. */
const STATUS_HOJE = "CHECK ((status = ANY (ARRAY['open'::text, 'partially_paid'::text, 'paid'::text, 'cancelled'::text])))";
const STATUS_DEPOIS = "CHECK ((status = ANY (ARRAY['open'::text, 'partially_paid'::text, 'paid'::text, 'cancelled'::text, 'previsto'::text])))";

/** As mensagens de NEGÓCIO dos gatilhos (com acento e código conhecido: é o que o fromPgError entrega). */
const BAIXA_NO_PREVISTO = "CONFLICT: Título previsto não recebe baixa: ele dá lugar ao título de verdade quando o documento é faturado.";
const GUARDA_DO_PREVISTO = "CONFLICT: Título previsto não se altera: ele só sai da previsão cancelado, e o título de verdade nasce do documento.";
const padroesImutaveis = (op: string) => `CONFLICT: Os padrões financeiros de uma versão de TOP não aceitam ${op} (a edição cria uma versão nova).`;

/** As 7 colunas novas nas tabelas de hoje (tabela, coluna, tipo do catálogo). */
const COLUNAS_NOVAS: [string, string, string][] = [
  ["financial_titles", "tipo_operacao_id", "uuid"], ["financial_titles", "tipo_operacao_versao_id", "uuid"],
  ["title_settlements", "imovel_rural_id", "uuid"],
  ["bank_movements", "imovel_rural_id", "uuid"], ["bank_movements", "tipo_operacao_id", "uuid"], ["bank_movements", "tipo_operacao_versao_id", "uuid"],
  ["financial_categories", "tipo_lcdpr", "text"]
];

let seq = 0;
const id1 = async (q: Queryable, sql: string, p: unknown[] = []) => (await q.query<{ id: string }>(sql, p)).rows[0]!.id;
const sqlDa0045 = () => listMigrations().find((x) => x.name === ALVO)!.sql;

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
/** Roda `sql` (a 0045, ou um trecho dela) numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a recusa, e o SQL aplicou");
}
const recusaDa0045 = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(sqlDa0045(), antes);
interface ErroPg { code?: string; constraint?: string; message: string }
async function erroDe(p: Promise<unknown>): Promise<ErroPg> {
  try { await p; } catch (e) { return e as ErroPg; }
  throw new Error("esperava recusa, e o banco aceitou");
}
/** [código, constraint] da recusa — a forma das asserções de integridade. */
const recusaDoBanco = async (p: Promise<unknown>) => { const e = await erroDe(p); return [e.code, e.constraint]; };
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
/** Os objetos que a 0045 cria — todos ausentes antes, todos presentes depois. */
const objetos = async () => (await db.query<{ imoveis: string | null; versao: string | null; topNoTitulo: boolean; imovelNaBaixa: boolean; lcdpr: boolean; guarda: string | null; imutavel: string | null }>(
  `select to_regclass('erp.imoveis_rurais')::text imoveis,
          to_regclass('erp.tipos_operacao_versao_financeiro')::text versao,
          exists (select 1 from information_schema.columns where table_schema='erp' and table_name='financial_titles' and column_name='tipo_operacao_id') "topNoTitulo",
          exists (select 1 from information_schema.columns where table_schema='erp' and table_name='title_settlements' and column_name='imovel_rural_id') "imovelNaBaixa",
          exists (select 1 from information_schema.columns where table_schema='erp' and table_name='financial_categories' and column_name='tipo_lcdpr') lcdpr,
          to_regprocedure('erp.financial_titles_previsto_guarda()')::text guarda,
          to_regprocedure('erp.tipos_operacao_versao_financeiro_imutavel()')::text imutavel`)).rows[0]!;
const NENHUM_OBJETO = { imoveis: null, versao: null, topNoTitulo: false, imovelNaBaixa: false, lcdpr: false, guarda: null, imutavel: null };
const corpoDoRefresh = async () => (await db.query<{ d: string }>("select pg_get_functiondef('erp.refresh_title_status(uuid)'::regprocedure) d")).rows[0]!.d;
const defDoStatus = async () => (await db.query<{ d: string | null }>(
  "select pg_get_constraintdef(oid) d from pg_constraint where conrelid='erp.financial_titles'::regclass and conname='financial_titles_status_check'")).rows[0]?.d ?? null;
/** O corpo de erp.refresh_title_status como uma migration do repositório o escreve (o create or replace inteiro). */
const corpoDaMigration = (prefixo: string) =>
  /create or replace function erp\.refresh_title_status[\s\S]*?end \$\$;/.exec(listMigrations().find((x) => x.name.startsWith(prefixo))!.sql)?.[0];

const ctxFin = (userId: string | null = demo.adminUserId, orgId: string = demo.orgId, modulo = "financeiro"): TenantContext => ({ orgId, userId, modulo });

/** As seções de hoje no neutro (o CHECK de forma da 0022 exige as cinco); o formato não importa para a 0045. */
const CONFIGURACAO = {
  versaoSchema: 1,
  geral: { confirmacao: "manual", exigeParceiro: false, exigeCentroResultado: false, exigeObservacao: false, alteracaoAposConfirmacao: "bloqueada", documentoSemItens: "proibido" },
  estoque: { atualizacao: "nenhuma", momento: "confirmacao", exigeArmazem: false, saldoNegativo: "bloquear" },
  financeiro: { atualizacao: "nenhuma", modo: "incluir", momento: "confirmacao", exigeFormaPagamento: false, exigeVencimento: false, exigeCentroResultado: false },
  fiscal: { habilitado: false, exigeDocumentoFiscal: false, exigeNaturezaOperacao: false, exigeRegraTributaria: false, calculoTributario: "nao_aplicar" },
  aprovacao: { politica: "nenhuma", valorMinimo: null, momento: "antes_da_confirmacao" }
};
async function criarTop(org: string, codigoBase: string): Promise<Top> {
  seq += 1;
  return withTx(db, { orgId: org, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [org, `F9T${seq}`, codigoBase])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
       values ($1,$2,1,$3,$4::jsonb,1) returning id`,
      [org, top, `TOP F9 ${codigoBase} ${seq}`, JSON.stringify(CONFIGURACAO)])).rows[0]!.id;
    return { top, versao };
  });
}

interface NovoTitulo { status?: string; valor?: string; pago?: string; origemTipo?: string | null; origemId?: string | null; empresa?: string; pessoa?: string; org?: string; top?: Top | null; soTop?: string; soVersao?: string }
/** Título (superusuário: o cenário; ou pela transação da aplicação). Origem padrão: um pedido de venda (a provisão). */
async function titulo(q: Queryable, o: NovoTitulo = {}): Promise<string> {
  seq += 1;
  return id1(q,
    `insert into erp.financial_titles (organization_id, empresa_id, code, direction, number, person_id, amount, paid_amount, emission_date, due_date,
                                       status, source_type, source_id, tipo_operacao_id, tipo_operacao_versao_id)
     values ($1,$2,$3,'receivable',$4,$5,$6,$7,'2026-10-01','2026-10-31',$8,$9,$10,$11,$12) returning id`,
    [o.org ?? demo.orgId, o.empresa ?? A, `F9-${seq}`, `PED-F9-${seq}`, o.pessoa ?? cliente, o.valor ?? "100.00", o.pago ?? "0",
     o.status ?? "open", o.origemTipo === undefined ? "sales_documents" : o.origemTipo, o.origemId === undefined ? "00000000-0000-4000-8000-0000000000f9" : o.origemId,
     o.soTop ?? o.top?.top ?? null, o.soVersao ?? o.top?.versao ?? null]);
}
interface NovoMovimento { empresa?: string | null; categoria?: string; imovel?: string | null; top?: Top | null; soTop?: string; soVersao?: string; org?: string; conta?: string }
async function movimento(q: Queryable, o: NovoMovimento = {}): Promise<string> {
  seq += 1;
  const categoria = o.categoria ?? "out";
  return id1(q,
    `insert into erp.bank_movements (organization_id, code, bank_account_id, movement_date, type, category_type, amount, empresa_id,
                                     imovel_rural_id, tipo_operacao_id, tipo_operacao_versao_id)
     values ($1,$2,$3,'2026-10-05',$4,$5,10,$6,$7,$8,$9) returning id`,
    [o.org ?? demo.orgId, `F9M-${seq}`, o.conta ?? contaBB, categoria === "in" || categoria === "opening_balance" ? "in" : "out", categoria,
     o.empresa === undefined ? A : o.empresa, o.imovel ?? null, o.soTop ?? o.top?.top ?? null, o.soVersao ?? o.top?.versao ?? null]);
}
/** Baixa bancária pelo `q` dado: o INSERT de hoje, e o imóvel só quando pedido. */
async function baixa(q: Queryable, tituloId: string, valor: string, imovel?: string, org = demo.orgId): Promise<string> {
  const comImovel = imovel !== undefined;
  return id1(q,
    `insert into erp.title_settlements (organization_id, title_id, settlement_date, settlement_kind, bank_account_id, amount, discount, net_amount, status${comImovel ? ", imovel_rural_id" : ""})
     values ($1,$2,'2026-10-05','bank_movement',$3,$4,0,$4,'confirmed'${comImovel ? ",$5" : ""}) returning id`,
    comImovel ? [org, tituloId, org === demo.orgId ? contaBB : contaOutraOrg, valor, imovel] : [org, tituloId, org === demo.orgId ? contaBB : contaOutraOrg, valor]);
}
interface NovoImovel { empresa?: string; nome?: string; cib?: string | null; caepf?: string | null; ie?: string | null; tipo?: string; participacao?: string; padrao?: boolean; org?: string }
async function imovel(q: Queryable, o: NovoImovel = {}): Promise<string> {
  seq += 1;
  return id1(q,
    `insert into erp.imoveis_rurais (organization_id, empresa_id, nome, cib, caepf, inscricao_estadual, tipo_exploracao, participacao, padrao)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [o.org ?? demo.orgId, o.empresa ?? A, o.nome ?? `[TEST] Imóvel F9 ${seq}`, o.cib ?? null, o.caepf ?? null, o.ie ?? null, o.tipo ?? "individual",
     o.participacao ?? "100", o.padrao ?? false]);
}
interface NovosPadroes { top?: Top; natureza?: string | null; centro?: string | null; tipo?: string | null; forma?: string | null; conta?: string | null; org?: string }
async function padroes(q: Queryable, o: NovosPadroes): Promise<string> {
  const top = o.top ?? topA;
  return id1(q,
    `insert into erp.tipos_operacao_versao_financeiro (organization_id, origem_versao_id, origem_tipo_operacao_id, natureza_id, centro_custo_id, tipo_titulo_id, forma_pagamento_id, conta_bancaria_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [o.org ?? demo.orgId, top.versao, top.top, o.natureza ?? null, o.centro ?? null, o.tipo ?? null, o.forma ?? null, o.conta ?? null]);
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of ANTERIORES) {
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
  cliente = await id1(db, "insert into erp.people (organization_id, code, name, is_client) values ($1,'F9-C1','[TEST] Cliente F9',true) returning id", [demo.orgId]);
  outroCliente = await id1(db, "insert into erp.people (organization_id, code, name, is_client) values ($1,'F9-C2','[TEST] Outro cliente F9',true) returning id", [demo.orgId]);
  natReceita = await id1(db, "insert into erp.financial_categories (organization_id, code, name, nature, kind) values ($1,'F9.R','[TEST] Receita F9','income','analytic') returning id", [demo.orgId]);
  natDespesa = await id1(db, "insert into erp.financial_categories (organization_id, code, name, nature, kind) values ($1,'F9.D','[TEST] Despesa F9','expense','analytic') returning id", [demo.orgId]);
  centro = await id1(db, "insert into erp.cost_centers (organization_id, code, name, kind) values ($1,'F9.C','[TEST] Centro F9','analytic') returning id", [demo.orgId]);
  tipoBoleto = await id1(db, "select id from erp.title_types where organization_id is null and name='Boleto'");
  formaSistema = await id1(db, "select id from erp.payment_methods where organization_id is null order by name limit 1");

  outraOrg = await id1(db, "insert into erp.organizations (name, slug) values ('[TEST] Outra F9','outra-f9') returning id");
  empresaOutraOrg = await id1(db, "insert into erp.empresas (organization_id, code, name) values ($1, 95, '[TEST] Empresa outra org F9') returning id", [outraOrg]);
  natOutraOrg = await id1(db, "insert into erp.financial_categories (organization_id, code, name, nature, kind) values ($1,'F9.X','[TEST] Natureza outra org F9','income','analytic') returning id", [outraOrg]);
  centroOutraOrg = await id1(db, "insert into erp.cost_centers (organization_id, code, name, kind) values ($1,'F9.XC','[TEST] Centro outra org F9','analytic') returning id", [outraOrg]);
  contaOutraOrg = await id1(db, "insert into erp.bank_accounts (organization_id, code, description, type) values ($1,'F9X','[TEST] Conta outra org F9','checking') returning id", [outraOrg]);

  topA = await criarTop(demo.orgId, "vendas.pedido");
  topB = await criarTop(demo.orgId, "vendas.venda");
  topOutraOrg = await criarTop(outraOrg, "vendas.pedido");

  // Membro com escopo SELECIONADAS = [B] no financeiro, e nada nos outros módulos (fail-closed).
  usuarioSoB = await id1(db, "insert into erp.users (email, name, password_hash) values ('f9-so-b@demo.local','F9 Só B','x') returning id");
  const membro = await id1(db, "insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuarioSoB]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'financeiro','selecionadas')", [demo.orgId, membro]);
  await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'financeiro','selecionadas',$3)", [demo.orgId, membro, B]);
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("DB-0 a DB-2 — a 0045 sobre o banco até a anterior: premissa, trava, lock_timeout e pré-condições", () => {
  it("DB-0 PREMISSA: o ledger tem todas as anteriores (a 0042 entre elas) e não a 0045; os objetos não existem; o CHECK de hoje recusa 'previsto'", async () => {
    expect(await noLedger()).toBe(false);
    expect(ANTERIORES.length, "o banco sobe até a 0042 (OPERACOES-01 F8), no mínimo").toBeGreaterThanOrEqual(42);
    expect(ANTERIORES.map((x) => x.name)).toContain("0042_central_financeira.sql");
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length, ultima: ANTERIORES.at(-1)!.name });
    expect(await objetos()).toEqual(NENHUM_OBJETO);
    expect(await defDoStatus()).toBe(STATUS_HOJE);
    expect(await corpoDoRefresh()).not.toContain("previsto");
    // O 'previsto' de hoje: o CHECK de situação recusa (o mesmo INSERT de origem válida passa a gravar depois).
    const e = await erroDe(db.query(
      `insert into erp.financial_titles (organization_id, empresa_id, code, direction, number, person_id, amount, emission_date, due_date, status, source_type, source_id)
       values ($1,$2,'F9-PREMISSA','receivable','PED-F9-PREMISSA',$3,100,'2026-10-01','2026-10-31','previsto','sales_documents',gen_random_uuid())`, [demo.orgId, A, cliente]));
    expect([e.code, e.constraint]).toEqual(["23514", "financial_titles_status_check"]);
    // O cenário: duas empresas, duas TOPs da organização e uma de outra, e o membro só de B.
    expect(A).not.toBe(B);
    expect(new Set([topA.versao, topB.versao, topOutraOrg.versao]).size).toBe(3);
    expect((await db.query("select 1 from erp.modulos_escopo_empresa where chave='financeiro'")).rowCount).toBe(1);
  });

  it("DB-1.1 trava (2026,79) em uso por outra sessão: a 0045 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 79)");
      await expect(aplicar()).rejects.toThrow(TRAVA);
    } finally { await outra.query("select pg_advisory_unlock(2026, 79)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await objetos()).toEqual(NENHUM_OBJETO);
  });

  it("DB-1.2 lock_timeout 2s: uma escrita aberta em erp.financial_titles faz a 0045 desistir em ~2s, sem efeito", async () => {
    const escritor = await db.connect();
    try {
      await escritor.query("begin");
      // RowExclusive no título: o ADD COLUMN precisa de AccessExclusive, e os dois não convivem.
      await escritor.query("update erp.financial_titles set code = code where id is null");
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await escritor.query("rollback"); escritor.release(); }
    expect(await noLedger()).toBe(false);
    expect(await objetos()).toEqual(NENHUM_OBJETO);
  });

  it("DB-2 reversas: cada pré-condição quebrada recusa a 0045 com a SUA mensagem, sem efeito", async () => {
    // P1 "já aplicada": cada um dos cinco objetos.
    for (const [nome, sabotagem] of [
      ["tabela do imóvel", "create table erp.imoveis_rurais (id int)"],
      ["tabela dos padrões", "create table erp.tipos_operacao_versao_financeiro (id int)"],
      ["TOP no título", "alter table erp.financial_titles add column tipo_operacao_id uuid"],
      ["tipo LCDPR", "alter table erp.financial_categories add column tipo_lcdpr text"],
      ["guarda do previsto", "create function erp.financial_titles_previsto_guarda() returns trigger language plpgsql as $f$ begin return new; end $f$"]
    ] as [string, string][]) {
      expect([nome, await recusaDa0045((c) => c.query(sabotagem))]).toEqual([nome, JA]);
    }
    // "Já aplicada" vem ANTES de todas: com uma coluna, um gatilho, uma chave alvo, o módulo e o papel quebrados JUNTO,
    // o motivo dito é o verdadeiro.
    expect(await recusaDa0045(async (c) => {
      await c.query("alter table erp.financial_titles rename column paid_amount to paid_amount_f9");
      await c.query("drop trigger trg_ft_updated on erp.financial_titles");
      await c.query("alter table erp.cost_centers rename constraint uq_cost_centers_tenant to uq_f9");
      await c.query("set local session_replication_role = replica");
      await c.query("delete from erp.modulos_escopo_empresa where chave='financeiro'");
      await c.query("set local session_replication_role = origin");
      await c.query("create table erp.imoveis_rurais (id int)");
      await c.query("set local role erp_app");
    })).toBe(JA);
    // P2 sem o papel da aplicação.
    expect(await recusaDa0045((c) => c.query("alter role erp_app rename to erp_app_f9"))).toBe(PAPEL);
    // P3 quem aplica não atravessa RLS (o papel da aplicação).
    expect(await recusaDa0045((c) => c.query("set local role erp_app"))).toBe(BYPASS);
    // P4 cada coluna lida (35), uma de cada vez.
    const colunas: [string, string][] = [
      ...["id", "organization_id", "empresa_id", "direction", "person_id", "amount", "discount", "paid_amount", "status", "source_type", "source_id", "version"]
        .map((c): [string, string] => ["financial_titles", c]),
      ...["id", "organization_id", "title_id", "amount", "status"].map((c): [string, string] => ["title_settlements", c]),
      ...["id", "organization_id", "empresa_id", "category_type", "movement_date"].map((c): [string, string] => ["bank_movements", c]),
      ...["financial_categories", "cost_centers", "bank_accounts", "title_types", "payment_methods"]
        .flatMap((t) => ["id", "organization_id"].map((c): [string, string] => [t, c])),
      ...["id", "tipo_operacao_id", "organization_id"].map((c): [string, string] => ["tipos_operacao_versoes", c])
    ];
    expect(colunas).toHaveLength(35);
    for (const [tabela, coluna] of colunas) {
      expect([tabela, coluna, await recusaDa0045((c) => c.query(`alter table erp.${tabela} rename column ${coluna} to ${coluna}_f9`))]).toEqual([tabela, coluna, COLUNA]);
    }
    // P5 cada chave alvo das FKs compostas, e a chave (organization_id, id) de empresas.
    for (const [tabela, chave] of [["tipos_operacao_versoes", "uq_tipos_operacao_versoes_tenant"], ["financial_categories", "uq_financial_categories_tenant"],
      ["cost_centers", "uq_cost_centers_tenant"], ["bank_accounts", "uq_bank_accounts_tenant"]] as [string, string][]) {
      expect([chave, await recusaDa0045((c) => c.query(`alter table erp.${tabela} rename constraint ${chave} to ${chave}_f9`))]).toEqual([chave, CHAVE]);
    }
    expect(await recusaDa0045(async (c) => {
      const nomes = (await c.query<{ conname: string }>(
        `select c.conname from pg_constraint c where c.conrelid='erp.empresas'::regclass and c.contype in ('u','p')
            and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid=c.conrelid and a.attnum = any (c.conkey)) = array['id','organization_id']`)).rows;
      expect(nomes.length, "a chave existe antes da sabotagem").toBeGreaterThan(0);
      for (const n of nomes) await c.query(`alter table erp.empresas drop constraint "${n.conname}" cascade`);
    })).toBe(EMPRESAS);
    // P6 cada função chamada.
    for (const fn of ["tenant_visible(uuid)", "audit_row()", "set_updated_at()", "escopo_empresa_total(text)", "empresas_do_membro(text)",
      "modulo_empresa_atual()", "refresh_title_status(uuid)", "title_settlement_changed()"]) {
      expect([fn, await recusaDa0045((c) => c.query(`alter function erp.${fn} rename to f9_renomeada`))]).toEqual([fn, FUNCOES]);
    }
    // P7 o módulo de escopo financeiro (as FKs de quem o cita são desligadas só nesta transação desfeita).
    expect(await recusaDa0045(async (c) => {
      await c.query("set local session_replication_role = replica");
      await c.query("delete from erp.modulos_escopo_empresa where chave='financeiro'");
      await c.query("set local session_replication_role = origin");
    })).toBe(MODULO);
    // P8 o CHECK de situação EXATAMENTE o de hoje: já alargado, com outra ordem, ou ausente — com o texto no diagnóstico.
    const trocarStatus = (lista: string) => (c: Tx) => c.query(
      `alter table erp.financial_titles drop constraint financial_titles_status_check, add constraint financial_titles_status_check check (status in (${lista}))`);
    expect(await recusaDa0045(trocarStatus("'open', 'partially_paid', 'paid', 'cancelled', 'previsto'"))).toBe(checkDeStatus(STATUS_DEPOIS));
    expect(await recusaDa0045(trocarStatus("'cancelled', 'open', 'partially_paid', 'paid'")))
      .toBe(checkDeStatus("CHECK ((status = ANY (ARRAY['cancelled'::text, 'open'::text, 'partially_paid'::text, 'paid'::text])))"));
    expect(await recusaDa0045((c) => c.query("alter table erp.financial_titles drop constraint financial_titles_status_check"))).toBe(checkDeStatus("<NULL>"));
    // P9 o conjunto EXATO dos gatilhos do título: um a menos, um a mais.
    expect(await recusaDa0045((c) => c.query("drop trigger trg_ft_updated on erp.financial_titles"))).toBe(gatilhosDoTitulo("{trg_ft_audit}"));
    expect(await recusaDa0045((c) => c.query("create trigger trg_ft_zz after insert on erp.financial_titles for each row execute function erp.audit_row()")))
      .toBe(gatilhosDoTitulo("{trg_ft_audit,trg_ft_updated,trg_ft_zz}"));
    // P10 o corpo de erp.refresh_title_status é o da 0042: o da 0004 (amount + discount), o da 0042 já falando de
    // previsto, e um sem o retorno do cancelado.
    const refresh0004 = corpoDaMigration("0004_");
    const refresh0042 = corpoDaMigration("0042_");
    expect(refresh0004, "o corpo da 0004 foi encontrado").toContain("sum(amount + discount)");
    expect(refresh0042, "o corpo da 0042 foi encontrado").toContain("if v_status = 'cancelled' then return; end if;");
    expect(await recusaDa0045((c) => c.query(refresh0004!))).toBe(REFRESH_DE_OUTRO);
    expect(await recusaDa0045((c) => c.query(refresh0042!.replace("begin\n", "begin\n  -- previsto: ainda nao\n")))).toBe(REFRESH_DE_OUTRO);
    expect(await recusaDa0045((c) => c.query(refresh0042!.replace("if v_status = 'cancelled' then return; end if;", "if v_status = 'cancelled' then null; end if;"))))
      .toBe(REFRESH_DE_OUTRO);
    // Nada ficou: o ledger, os objetos, o CHECK, o corpo e o papel são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await objetos()).toEqual(NENHUM_OBJETO);
    expect(await defDoStatus()).toBe(STATUS_HOJE);
    expect(await corpoDoRefresh()).not.toContain("previsto");
    expect((await db.query("select 1 from pg_roles where rolname='erp_app'")).rowCount).toBe(1);
  });
});

describe("DB-3 — a 0045 aplica", () => {
  it("DB-3.1 aplica: ledger com a 0045 por último, logo depois das anteriores no repositório; objetos criados; trava liberada", async () => {
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: ANTERIORES.length + 1, ultima: ALVO });
    const noDisco = listMigrations().map((m) => m.name);
    expect(noDisco.indexOf(ALVO), "a 0045 vem logo depois das anteriores no repositório").toBe(ANTERIORES.length);
    expect(await objetos()).toEqual({
      imoveis: "erp.imoveis_rurais", versao: "erp.tipos_operacao_versao_financeiro", topNoTitulo: true, imovelNaBaixa: true, lcdpr: true,
      guarda: "erp.financial_titles_previsto_guarda()", imutavel: "erp.tipos_operacao_versao_financeiro_imutavel()"
    });
    expect(await defDoStatus()).toBe(STATUS_DEPOIS);
    // A trava é de transação: depois do commit, outra sessão a obtém.
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 79) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("DB-3.2 catálogo: as 7 colunas novas anuláveis e sem default, e TODA coluna e tabela nova (e as funções) comentada", async () => {
    const r = (await db.query<{ c: string }>(
      `select e.tabela || '.' || e.coluna || ':' || format_type(a.atttypid, a.atttypmod) || ':' || (not a.attnotnull) || ':' || a.atthasdef
              || ':' || (col_description(a.attrelid, a.attnum) is not null) c
         from unnest($1::text[], $2::text[]) e(tabela, coluna)
         join pg_attribute a on a.attrelid = ('erp.' || e.tabela)::regclass and a.attname = e.coluna and a.attnum > 0 and not a.attisdropped`,
      [COLUNAS_NOVAS.map((x) => x[0]), COLUNAS_NOVAS.map((x) => x[1])])).rows.map((x) => x.c);
    // Ordenadas aqui, não no banco: a ordenação do banco segue a collation, a do teste não.
    expect(r.sort()).toEqual(COLUNAS_NOVAS.map(([t, c, tipo]) => `${t}.${c}:${tipo}:true:false:true`).sort());
    const semComentario = (await db.query<{ c: string }>(
      `select c.relname || '.' || coalesce(a.attname, '(tabela)') c from pg_class c
         left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where c.oid in ('erp.imoveis_rurais'::regclass, 'erp.tipos_operacao_versao_financeiro'::regclass)
          and (case when a.attname is null then obj_description(c.oid, 'pg_class') else col_description(c.oid, a.attnum) end) is null`)).rows;
    expect(semComentario).toEqual([]);
    const colunasDasNovas = (await db.query<{ n: number }>(
      `select count(*)::int n from pg_attribute where attrelid in ('erp.imoveis_rurais'::regclass, 'erp.tipos_operacao_versao_financeiro'::regclass) and attnum > 0 and not attisdropped`)).rows[0]!.n;
    expect(colunasDasNovas, "a conta acima varreu as 14 + 11 colunas").toBe(25);
    // O comentário da TABELA (a consulta acima só cai no ramo "(tabela)" para tabela sem coluna).
    const tabelasComentadas = (await db.query<{ n: number }>(
      `select count(*)::int n from unnest(array['erp.imoveis_rurais', 'erp.tipos_operacao_versao_financeiro']) t(x)
        where length(obj_description(x::regclass, 'pg_class')) > 0`)).rows[0]!.n;
    expect(tabelasComentadas).toBe(2);
    const fns = (await db.query<{ n: number }>(
      `select count(*)::int n from unnest(array['erp.financial_titles_previsto_guarda()', 'erp.tipos_operacao_versao_financeiro_imutavel()', 'erp.refresh_title_status(uuid)']) f(x)
        where obj_description(x::regprocedure, 'pg_proc') is not null`)).rows[0]!.n;
    expect(fns).toBe(3);
    // A soma B da 0042 continua, com a linha do previsto.
    const corpo = await corpoDoRefresh();
    expect(corpo).toContain("sum(amount)");
    expect(corpo).not.toContain("amount + discount");
    expect(corpo).toContain(BAIXA_NO_PREVISTO);
  });
});

describe("DB-4 — o comportamento da 0045", () => {
  it("DB-4a o título previsto: grava com origem de documento e nada pago; sem origem, avulso ou pago → 23514", async () => {
    // Pelo papel da aplicação, como a provisão grava.
    const previsto = await withTx(app, ctxFin(), (tx) => titulo(tx, { status: "previsto", top: topA }));
    expect((await db.query("select status, paid_amount, source_type, tipo_operacao_versao_id from erp.financial_titles where id=$1", [previsto])).rows)
      .toEqual([{ status: "previsto", paid_amount: "0.00", source_type: "sales_documents", tipo_operacao_versao_id: topA.versao }]);
    const casos: [string, NovoTitulo][] = [
      ["sem origem (tipo nulo)", { status: "previsto", origemTipo: null }],
      ["sem origem (id nulo)", { status: "previsto", origemId: null }],
      ["avulso", { status: "previsto", origemTipo: "manual" }],
      ["já pago", { status: "previsto", pago: "10.00" }]
    ];
    for (const [nome, o] of casos) {
      expect([nome, await recusaDoBanco(titulo(db, o))]).toEqual([nome, ["23514", "chk_financial_titles_previsto"]]);
    }
    // Premissa: o MESMO título aberto, sem origem e avulso, passa (a regra é só do previsto).
    expect(await titulo(db, { origemTipo: null, origemId: null })).toBeTruthy();
    expect(await titulo(db, { origemTipo: "manual" })).toBeTruthy();
  });

  it("DB-4b o previsto só sai da previsão cancelado; nenhum título vira previsto por UPDATE; o vencimento continua atualizável", async () => {
    const previsto = await titulo(db, { status: "previsto", valor: "300.00" });
    const naApp = (set: string, p: unknown[] = [], id = previsto) =>
      withTx(app, ctxFin(), (tx) => tx.query(`update erp.financial_titles set ${set} where id=$1`, [id, ...p]));
    for (const [nome, set, p] of [
      ["virar aberto", "status = 'open'", []], ["virar pago", "status = 'paid'", []], ["virar parcial", "status = 'partially_paid'", []],
      ["valor", "amount = 301", []], ["desconto", "discount = 1", []], ["pago", "paid_amount = 1", []],
      ["parceiro", "person_id = $2", [outroCliente]], ["empresa", "empresa_id = $2", [B]], ["direção", "direction = 'payable'", []],
      ["origem (tipo)", "source_type = 'documentos_compra'", []], ["origem (id)", "source_id = gen_random_uuid()", []],
      ["cancelar e mudar o valor no MESMO comando", "status = 'cancelled', amount = 1", []]
    ] as [string, string, unknown[]][]) {
      expect([nome, (await erroDe(naApp(set, p))).message]).toEqual([nome, GUARDA_DO_PREVISTO]);
    }
    // Nem o dono (superusuário): o gatilho vale para todos.
    expect((await erroDe(db.query("update erp.financial_titles set amount = 999 where id=$1", [previsto]))).message).toBe(GUARDA_DO_PREVISTO);
    // O que não é valor nem origem continua atualizável (ROW COUNT 1): vencimento, observação, conta prevista, versão.
    for (const [set, p] of [["due_date = '2026-11-15'", []], ["note = 'previsão revista'", []], ["conta_prevista_id = $2", [contaCaixa]],
      ["version = version + 1", []]] as [string, unknown[]][]) {
      expect([set, (await naApp(set, p)).rowCount]).toEqual([set, 1]);
    }
    expect((await db.query("select status, amount, due_date from erp.financial_titles where id=$1", [previsto])).rows)
      .toEqual([{ status: "previsto", amount: "300.00", due_date: "2026-11-15" }]);
    // Nenhum título vira previsto por UPDATE: nem o aberto com origem, nem pelo dono.
    const aberto = await titulo(db, {});
    expect((await erroDe(naApp("status = 'previsto'", [], aberto))).message).toBe(GUARDA_DO_PREVISTO);
    expect((await erroDe(db.query("update erp.financial_titles set status = 'previsto' where id=$1", [aberto]))).message).toBe(GUARDA_DO_PREVISTO);
    // A saída: cancelado, com a trilha (como a provisão cancela) — e a linha FICA (nunca se apaga, decisão 247).
    const cancelar = await naApp("status = 'cancelled', cancel_reason = 'Pedido alterado', cancelled_at = now(), cancelled_by = $2, version = version + 1",
      [demo.adminUserId]);
    expect(cancelar.rowCount).toBe(1);
    expect((await db.query("select status, amount, cancel_reason, cancelled_by from erp.financial_titles where id=$1", [previsto])).rows)
      .toEqual([{ status: "cancelled", amount: "300.00", cancel_reason: "Pedido alterado", cancelled_by: demo.adminUserId }]);
    // O previsto cancelado não volta a ser previsto.
    expect((await erroDe(db.query("update erp.financial_titles set status = 'previsto' where id=$1", [previsto]))).message).toBe(GUARDA_DO_PREVISTO);
  });

  it("DB-4c a baixa num previsto morre no banco (CONFLICT, pelo papel da aplicação e pela função direta); a baixa num aberto continua", async () => {
    const aberto = await titulo(db, { valor: "100.00" });
    await withTx(app, ctxFin(), (tx) => baixa(tx, aberto, "40.00"));
    expect((await db.query("select status, paid_amount from erp.financial_titles where id=$1", [aberto])).rows)
      .toEqual([{ status: "partially_paid", paid_amount: "40.00" }]);
    const previsto = await titulo(db, { status: "previsto", valor: "100.00" });
    expect((await erroDe(withTx(app, ctxFin(), (tx) => baixa(tx, previsto, "40.00")))).message).toBe(BAIXA_NO_PREVISTO);
    // A API chama a função direto (PUT do título): também recusa no previsto.
    expect((await erroDe(withTx(app, ctxFin(), (tx) => tx.query("select erp.refresh_title_status($1)", [previsto])))).message).toBe(BAIXA_NO_PREVISTO);
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.title_settlements where title_id=$1", [previsto])).rows[0]!.n).toBe(0);
    expect((await db.query("select status, paid_amount from erp.financial_titles where id=$1", [previsto])).rows)
      .toEqual([{ status: "previsto", paid_amount: "0.00" }]);
    // Cancelado, a função volta a ser no-op (o retorno do cancelado vem antes).
    await db.query("update erp.financial_titles set status = 'cancelled' where id=$1", [previsto]);
    await expect(withTx(app, ctxFin(), (tx) => tx.query("select erp.refresh_title_status($1)", [previsto]))).resolves.toBeTruthy();
  });

  it("DB-4d o imóvel do movimento é da empresa do movimento, e só em lançamento de caixa com empresa; o da baixa é da organização", async () => {
    const imovelA = await imovel(db, { empresa: A });
    const imovelB = await imovel(db, { empresa: B });
    const imovelOutraOrg = await imovel(db, { org: outraOrg, empresa: empresaOutraOrg });
    // Pelo papel da aplicação: o imóvel da empresa do movimento passa, em entrada e em saída.
    for (const categoria of ["out", "in"]) {
      const mv = await withTx(app, ctxFin(), (tx) => movimento(tx, { empresa: A, imovel: imovelA, categoria }));
      expect([categoria, (await db.query("select imovel_rural_id from erp.bank_movements where id=$1", [mv])).rows[0]]).toEqual([categoria, { imovel_rural_id: imovelA }]);
    }
    expect(await recusaDoBanco(movimento(db, { empresa: A, imovel: imovelB }))).toEqual(["23503", "fk_bank_movements_imovel_rural"]);
    expect(await recusaDoBanco(movimento(db, { empresa: null, imovel: imovelA }))).toEqual(["23514", "chk_bank_movements_imovel_rural"]);
    for (const categoria of ["internal_transfer", "opening_balance"]) {
      expect([categoria, await recusaDoBanco(movimento(db, { empresa: A, imovel: imovelA, categoria }))]).toEqual([categoria, ["23514", "chk_bank_movements_imovel_rural"]]);
      // Premissa: sem imóvel, a mesma categoria passa (a recusa acima é do imóvel, não da categoria).
      const semImovel = await movimento(db, { empresa: A, categoria });
      expect([categoria, (await db.query("select category_type, imovel_rural_id from erp.bank_movements where id=$1", [semImovel])).rows[0]])
        .toEqual([categoria, { category_type: categoria, imovel_rural_id: null }]);
    }
    // A baixa: o imóvel da organização passa; o de outra organização não.
    const t = await titulo(db, { valor: "50.00" });
    const s = await withTx(app, ctxFin(), (tx) => baixa(tx, t, "10.00", imovelB));
    expect((await db.query("select imovel_rural_id from erp.title_settlements where id=$1", [s])).rows[0]).toEqual({ imovel_rural_id: imovelB });
    expect(await recusaDoBanco(baixa(db, t, "10.00", imovelOutraOrg))).toEqual(["23503", "fk_title_settlements_imovel_rural"]);
  });

  it("DB-4e a TOP no título e no movimento: o par inteiro ou nada, e a versão DAQUELA TOP da organização", async () => {
    expect(await titulo(db, { top: topA })).toBeTruthy();
    expect(await recusaDoBanco(titulo(db, { soTop: topA.top, soVersao: topB.versao }))).toEqual(["23503", "fk_financial_titles_tipo_operacao_versao"]);
    expect(await recusaDoBanco(titulo(db, { soTop: topOutraOrg.top, soVersao: topOutraOrg.versao }))).toEqual(["23503", "fk_financial_titles_tipo_operacao_versao"]);
    expect(await recusaDoBanco(titulo(db, { soTop: topA.top }))).toEqual(["23514", "chk_financial_titles_tipo_operacao_par"]);
    expect(await recusaDoBanco(titulo(db, { soVersao: topA.versao }))).toEqual(["23514", "chk_financial_titles_tipo_operacao_par"]);
    expect(await movimento(db, { top: topB })).toBeTruthy();
    expect(await recusaDoBanco(movimento(db, { soTop: topB.top, soVersao: topA.versao }))).toEqual(["23503", "fk_bank_movements_tipo_operacao_versao"]);
    expect(await recusaDoBanco(movimento(db, { soTop: topB.top }))).toEqual(["23514", "chk_bank_movements_tipo_operacao_par"]);
    expect(await recusaDoBanco(movimento(db, { soVersao: topB.versao }))).toEqual(["23514", "chk_bank_movements_tipo_operacao_par"]);
  });

  it("DB-4f os padrões da versão: algum padrão, um por versão, FKs compostas, imutáveis para todos, RLS por tenant e auditoria", async () => {
    // Pelo papel da aplicação: os cinco padrões (tipo de título e forma do SISTEMA, organização nula).
    const linha = await withTx(app, ctxFin(), (tx) => padroes(tx, { top: topA, natureza: natReceita, centro, tipo: tipoBoleto, forma: formaSistema, conta: contaBB }));
    expect((await db.query("select natureza_id, centro_custo_id, tipo_titulo_id, forma_pagamento_id, conta_bancaria_id from erp.tipos_operacao_versao_financeiro where id=$1", [linha])).rows)
      .toEqual([{ natureza_id: natReceita, centro_custo_id: centro, tipo_titulo_id: tipoBoleto, forma_pagamento_id: formaSistema, conta_bancaria_id: contaBB }]);
    expect((await db.query("select action, user_id from erp.audit_logs where entity='tipos_operacao_versao_financeiro' and entity_id=$1", [linha])).rows)
      .toEqual([{ action: "create", user_id: demo.adminUserId }]);
    // Um por versão; nenhum padrão = nada a gravar.
    expect(await recusaDoBanco(padroes(db, { top: topA, natureza: natDespesa }))).toEqual(["23505", "uq_tipos_operacao_versao_financeiro"]);
    expect(await recusaDoBanco(padroes(db, { top: topB }))).toEqual(["23514", "chk_tipos_operacao_versao_financeiro_algum"]);
    // FKs compostas: cadastro de OUTRA organização (23503); a versão de OUTRA TOP; as da própria passam.
    expect(await recusaDoBanco(padroes(db, { top: topB, natureza: natOutraOrg }))).toEqual(["23503", "fk_tipos_operacao_versao_financeiro_natureza"]);
    expect(await recusaDoBanco(padroes(db, { top: topB, centro: centroOutraOrg }))).toEqual(["23503", "fk_tipos_operacao_versao_financeiro_centro"]);
    expect(await recusaDoBanco(padroes(db, { top: topB, conta: contaOutraOrg }))).toEqual(["23503", "fk_tipos_operacao_versao_financeiro_conta"]);
    // A versão de OUTRA TOP (a versão de topB, que ainda não tem linha: a recusa é da FK, não da unicidade).
    expect(await recusaDoBanco(padroes(db, { top: { top: topA.top, versao: topB.versao }, conta: contaBB }))).toEqual(["23503", "fk_tipos_operacao_versao_financeiro_origem"]);
    expect(await recusaDoBanco(padroes(db, { top: topB, tipo: "00000000-0000-4000-8000-0000000000f9" }))).toEqual(["23503", "fk_tipos_operacao_versao_financeiro_tipo_titulo"]);
    expect(await recusaDoBanco(padroes(db, { top: topB, forma: "00000000-0000-4000-8000-0000000000f9" }))).toEqual(["23503", "fk_tipos_operacao_versao_financeiro_forma"]);
    // Imutável para TODOS (o dono também): UPDATE, DELETE e TRUNCATE nomeiam a operação.
    expect((await erroDe(db.query("update erp.tipos_operacao_versao_financeiro set natureza_id = null where id=$1", [linha]))).message).toBe(padroesImutaveis("UPDATE"));
    expect((await erroDe(db.query("delete from erp.tipos_operacao_versao_financeiro where id=$1", [linha]))).message).toBe(padroesImutaveis("DELETE"));
    expect((await erroDe(db.query("truncate erp.tipos_operacao_versao_financeiro"))).message).toBe(padroesImutaveis("TRUNCATE"));
    // O papel da aplicação nem chega ao gatilho: não tem o privilégio (42501).
    for (const sql of ["update erp.tipos_operacao_versao_financeiro set natureza_id = null where id=$1", "delete from erp.tipos_operacao_versao_financeiro where id=$1"]) {
      expect([sql, (await erroDe(withTx(app, ctxFin(), (tx) => tx.query(sql, [linha])))).code]).toEqual([sql, "42501"]);
    }
    expect((await erroDe(withTx(app, ctxFin(), (tx) => tx.query("truncate erp.tipos_operacao_versao_financeiro")))).code).toBe("42501");
    // RLS por tenant: a linha de outra organização existe (superusuário), e a organização demo não a vê nem grava lá.
    const alheia = await padroes(db, { org: outraOrg, top: topOutraOrg, natureza: natOutraOrg });
    const vistas = (await withTx(app, ctxFin(), (tx) => tx.query<{ id: string }>("select id from erp.tipos_operacao_versao_financeiro where id = any($1::uuid[]) order by id", [[linha, alheia]]))).rows;
    expect(vistas).toEqual([{ id: linha }]);
    expect((await erroDe(withTx(app, ctxFin(), (tx) => padroes(tx, { org: outraOrg, top: topOutraOrg, natureza: natOutraOrg })))).code).toBe("42501");
    // A linha ficou como foi gravada.
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.tipos_operacao_versao_financeiro where id=$1 and natureza_id=$2", [linha, natReceita])).rows[0]!.n).toBe(1);
  });

  it("DB-4g o imóvel rural: um padrão e um CIB vivos por empresa, os CHECKs, a FK da empresa, a RLS por empresa, sem DELETE, auditoria e updated_at", async () => {
    // Pelo papel da aplicação (proprietário: escopo total): grava, audita.
    const padraoA = await withTx(app, ctxFin(), (tx) => imovel(tx, { empresa: A, padrao: true, cib: "12345678", caepf: "12345678901234", ie: "123456789", tipo: "arrendado", participacao: "50.50" }));
    expect((await db.query("select empresa_id, cib, caepf, tipo_exploracao, participacao, padrao, is_active, deleted_at from erp.imoveis_rurais where id=$1", [padraoA])).rows)
      .toEqual([{ empresa_id: A, cib: "12345678", caepf: "12345678901234", tipo_exploracao: "arrendado", participacao: "50.50", padrao: true, is_active: true, deleted_at: null }]);
    expect((await db.query("select action, user_id from erp.audit_logs where entity='imoveis_rurais' and entity_id=$1", [padraoA])).rows)
      .toEqual([{ action: "create", user_id: demo.adminUserId }]);
    // Os padrões da tabela: exploração individual, 100%, não padrão, ativo.
    const simples = await id1(db, "insert into erp.imoveis_rurais (organization_id, empresa_id, nome) values ($1,$2,'[TEST] Imóvel simples F9') returning id", [demo.orgId, B]);
    expect((await db.query("select tipo_exploracao, participacao, padrao, is_active from erp.imoveis_rurais where id=$1", [simples])).rows)
      .toEqual([{ tipo_exploracao: "individual", participacao: "100.00", padrao: false, is_active: true }]);
    // Um padrão VIVO por empresa; outra empresa tem o seu; o excluído não conta.
    expect(await recusaDoBanco(imovel(db, { empresa: A, padrao: true }))).toEqual(["23505", "ux_imoveis_rurais_padrao"]);
    expect(await imovel(db, { empresa: B, padrao: true })).toBeTruthy();
    // Um CIB vivo por empresa; o mesmo CIB em outra empresa passa.
    expect(await recusaDoBanco(imovel(db, { empresa: A, cib: "12345678" }))).toEqual(["23505", "ux_imoveis_rurais_cib"]);
    expect(await imovel(db, { empresa: B, cib: "12345678" })).toBeTruthy();
    // Exclusão LÓGICA do padrão (o papel da aplicação atualiza; não apaga): libera a marca e o CIB na empresa.
    const antes = (await db.query<{ u: string }>("select updated_at::text u from erp.imoveis_rurais where id=$1", [padraoA])).rows[0]!.u;
    expect((await withTx(app, ctxFin(), (tx) => tx.query("update erp.imoveis_rurais set deleted_at = now() where id=$1", [padraoA]))).rowCount).toBe(1);
    expect((await db.query<{ mudou: boolean }>("select updated_at > $2::timestamptz mudou from erp.imoveis_rurais where id=$1", [padraoA, antes])).rows[0]!.mudou).toBe(true);
    expect(await imovel(db, { empresa: A, padrao: true, cib: "12345678" })).toBeTruthy();
    // Os CHECKs, um de cada vez (a única diferença é o campo em teste).
    const casos: [string, NovoImovel, string][] = [
      ["CIB com 7 dígitos", { cib: "1234567" }, "chk_imoveis_rurais_cib"],
      ["CIB com letra", { cib: "1234567a" }, "chk_imoveis_rurais_cib"],
      ["CIB vazio", { cib: "" }, "chk_imoveis_rurais_cib"],
      ["CAEPF com 13 dígitos", { caepf: "1234567890123" }, "chk_imoveis_rurais_caepf"],
      ["CAEPF formatado", { caepf: "123.456.789/012-34" }, "chk_imoveis_rurais_caepf"],
      ["inscrição estadual com 21", { ie: "123456789012345678901" }, "chk_imoveis_rurais_inscricao_estadual"],
      ["nome em branco", { nome: "   " }, "chk_imoveis_rurais_nome"],
      ["nome com 121", { nome: "x".repeat(121) }, "chk_imoveis_rurais_nome"],
      ["exploração fora da lista", { tipo: "meeiro" }, "chk_imoveis_rurais_tipo_exploracao"],
      ["participação zero", { participacao: "0" }, "chk_imoveis_rurais_participacao"],
      ["participação acima de 100", { participacao: "100.01" }, "chk_imoveis_rurais_participacao"]
    ];
    for (const [nome, o, constraint] of casos) {
      expect([nome, await recusaDoBanco(imovel(db, { empresa: B, ...o }))]).toEqual([nome, ["23514", constraint]]);
    }
    // Premissa dos limites: 8 e 14 dígitos, 20 caracteres, 120 caracteres, 100% e 0,01% passam.
    expect(await imovel(db, { empresa: B, cib: "87654321", caepf: "98765432109876", ie: "x".repeat(20), nome: "y".repeat(120), participacao: "0.01" })).toBeTruthy();
    // A FK composta da empresa: empresa de OUTRA organização.
    expect(await recusaDoBanco(imovel(db, { org: demo.orgId, empresa: empresaOutraOrg }))).toEqual(["23503", "fk_imoveis_rurais_empresa"]);
    // RLS por empresa (módulo financeiro): o membro só de B vê e grava em B; não vê nem grava em A.
    const deA = await imovel(db, { empresa: A, nome: "[TEST] Imóvel de A" });
    const deB = await imovel(db, { empresa: B, nome: "[TEST] Imóvel de B" });
    const ctxSoB = ctxFin(usuarioSoB);
    const vistosPorB = (await withTx(app, ctxSoB, (tx) => tx.query<{ id: string }>("select id from erp.imoveis_rurais where id = any($1::uuid[])", [[deA, deB]]))).rows;
    expect(vistosPorB).toEqual([{ id: deB }]);
    expect((await withTx(app, ctxSoB, (tx) => tx.query("update erp.imoveis_rurais set nome = 'tentativa' where id=$1", [deA]))).rowCount).toBe(0);
    expect((await erroDe(withTx(app, ctxSoB, (tx) => imovel(tx, { empresa: A })))).code).toBe("42501");
    expect(await withTx(app, ctxSoB, (tx) => imovel(tx, { empresa: B }))).toBeTruthy();
    // Fail-closed: o mesmo membro, num módulo sem configuração, não vê nada.
    expect((await withTx(app, ctxFin(usuarioSoB, demo.orgId, "vendas"), (tx) => tx.query("select id from erp.imoveis_rurais where id = any($1::uuid[])", [[deA, deB]]))).rowCount).toBe(0);
    // Premissa: o proprietário vê as duas.
    expect((await withTx(app, ctxFin(), (tx) => tx.query("select id from erp.imoveis_rurais where id = any($1::uuid[])", [[deA, deB]]))).rowCount).toBe(2);
    // Sem DELETE nem TRUNCATE para o papel da aplicação (42501); as linhas ficam.
    expect((await erroDe(withTx(app, ctxFin(), (tx) => tx.query("delete from erp.imoveis_rurais where id=$1", [deA])))).code).toBe("42501");
    expect((await erroDe(withTx(app, ctxFin(), (tx) => tx.query("truncate erp.imoveis_rurais")))).code).toBe("42501");
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.imoveis_rurais where id = any($1::uuid[]) and nome like '[TEST] Imóvel de %'", [[deA, deB]])).rows[0]!.n).toBe(2);
  });

  it("DB-4h o tipo LCDPR da natureza: os quatro valores ou nulo; fora da lista → 23514", async () => {
    for (const tipo of ["receita", "custeio_investimento", "produto_adiantado", "fora", null]) {
      expect([tipo, (await db.query("update erp.financial_categories set tipo_lcdpr = $2 where id=$1", [natReceita, tipo])).rowCount]).toEqual([tipo, 1]);
    }
    expect(await recusaDoBanco(db.query("update erp.financial_categories set tipo_lcdpr = 'investimento' where id=$1", [natReceita])))
      .toEqual(["23514", "chk_financial_categories_tipo_lcdpr"]);
    expect(await recusaDoBanco(db.query("update erp.financial_categories set tipo_lcdpr = '1' where id=$1", [natReceita])))
      .toEqual(["23514", "chk_financial_categories_tipo_lcdpr"]);
    expect((await db.query("select tipo_lcdpr from erp.financial_categories where id=$1", [natReceita])).rows).toEqual([{ tipo_lcdpr: null }]);
  });
});

describe("DB-5 e DB-6 — pós-condições e reaplicação", () => {
  /**
   * As PÓS-CONDIÇÕES só leem OBJETOS (catálogo), nunca tabela viva — no deploy a tabela viva tem o dado de produção.
   * E cada uma morde: o bloco delas (o trecho "7)" do arquivo, como está) roda de novo sobre o banco aplicado, com UM
   * objeto quebrado numa transação desfeita, e recusa com a SUA mensagem.
   */
  it("DB-5 pós-condições: só de catálogo (nenhum FROM/JOIN em tabela do erp), e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const sql = sqlDa0045();
    const inicio = sql.indexOf("-- ---------- 7) pós-condições");
    expect(inicio, "o trecho 7) existe").toBeGreaterThan(0);
    const pos = sql.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    // Contraprova: sobre o banco aplicado (e já com dado: DB-4), o bloco passa.
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const TABELAS = `${M}erp.imoveis_rurais (14 colunas) ou erp.tipos_operacao_versao_financeiro (11 colunas) ausente ou fora do contrato.`;
    const RLS = `${M}tabelas novas sem RLS habilitada e forcada, ou com politica diferente da unica esperada (imoveis_rurais: tenant_e_empresa; tipos_operacao_versao_financeiro: tenant_isolation).`;
    const GABARITO = `${M}a politica tenant_e_empresa de erp.imoveis_rurais nao e o gabarito da categoria A (o mesmo predicado de erp.aprovacoes_venda, 0041).`;
    const COLUNAS = `${M}colunas novas ausentes, de outro tipo, obrigatorias ou com default (esperadas 7 anulaveis sem default).`;
    const UNICAS = `${M}chaves unicas novas ausentes ou fora da forma (uq_imoveis_rurais_tenant (id, organization_id), uq_imoveis_rurais_empresa (id, empresa_id, organization_id), uq_tipos_operacao_versao_financeiro (origem_versao_id)).`;
    const FKS = `${M}FKs novas ausentes ou fora da forma (colunas na ordem declarada, alvo certo, sem acao, validadas; esperadas 11).`;
    const CHECKS = `${M}CHECKs novos incompletos (esperados 12: imovel rural, padroes da versao, par da TOP, previsto, imovel do movimento, tipo LCDPR) ou financial_titles_status_check sem previsto.`;
    const INDICES = `${M}indices novos ausentes ou fora da forma (ux_imoveis_rurais_padrao e ux_imoveis_rurais_cib unicos e parciais, ix_imoveis_rurais_empresa, e os parciais de tipo_operacao, previsto_origem, imovel_rural da baixa e do movimento; esperados 7).`;
    const GATILHOS = `${M}gatilhos de financial_titles/imoveis_rurais/tipos_operacao_versao_financeiro ausentes, a mais, desligados, de outro tipo, com ou sem WHEN fora do esperado ou na funcao errada (esperados exatamente 8).`;
    const FN_GATILHO = `${M}funcoes de gatilho novas fora da forma (sem SECURITY DEFINER, search_path "erp, pg_temp", EXECUTE so do dono).`;
    const REFRESH = `${M}erp.refresh_title_status sem a recusa do previsto, fora da semantica B (sum(amount), sem amount + discount) ou sem EXECUTE do erp_app.`;
    const PRIVILEGIOS = `${M}privilegios do erp_app errados (imoveis_rurais: select/insert/update sem delete/truncate; tipos_operacao_versao_financeiro: select/insert sem update/delete/truncate).`;
    const refresh0042 = corpoDaMigration("0042_");
    expect(refresh0042, "o corpo da 0042 foi encontrado").not.toContain("previsto");
    const GUARDA_WHEN = `when ((old.status = 'previsto' and (new.status not in ('previsto', 'cancelled')
              or (old.amount, old.discount, old.paid_amount, old.person_id, old.empresa_id, old.direction, old.source_type, old.source_id)
                 is distinct from (new.amount, new.discount, new.paid_amount, new.person_id, new.empresa_id, new.direction, new.source_type, new.source_id)))
            or (old.status <> 'previsto' and new.status = 'previsto'))`;

    const casos: [string, string, string][] = [
      ["imóvel com coluna a mais", "alter table erp.imoveis_rurais add column f9_extra int", TABELAS],
      ["padrões com coluna a menos", "alter table erp.tipos_operacao_versao_financeiro drop column criado_em", TABELAS],
      ["imóvel sem force", "alter table erp.imoveis_rurais no force row level security", RLS],
      ["padrões sem RLS", "alter table erp.tipos_operacao_versao_financeiro disable row level security", RLS],
      ["política a mais nos padrões", "create policy f9_extra on erp.tipos_operacao_versao_financeiro for select using (true)", RLS],
      ["política do imóvel só de leitura", "drop policy tenant_e_empresa on erp.imoveis_rurais; create policy tenant_e_empresa on erp.imoveis_rurais for select to erp_app using (erp.tenant_visible(organization_id))", RLS],
      ["política do imóvel tenant-only (o vazamento)", "drop policy tenant_e_empresa on erp.imoveis_rurais; create policy tenant_e_empresa on erp.imoveis_rurais for all to erp_app, authenticated using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id))", GABARITO],
      ["coluna nova com default", "alter table erp.bank_movements alter column tipo_operacao_id set default gen_random_uuid()", COLUNAS],
      ["coluna nova de outro tipo", "alter table erp.financial_categories alter column tipo_lcdpr type varchar(30)", COLUNAS],
      ["coluna nova obrigatória", "update erp.financial_categories set tipo_lcdpr = 'fora'; alter table erp.financial_categories alter column tipo_lcdpr set not null", COLUNAS],
      ["coluna nova ausente", "alter table erp.title_settlements drop column imovel_rural_id", COLUNAS],
      ["chave do imóvel por empresa na ordem trocada", "alter table erp.imoveis_rurais drop constraint uq_imoveis_rurais_empresa cascade, add constraint uq_imoveis_rurais_empresa unique (empresa_id, id, organization_id)", UNICAS],
      ["mais de uma linha de padrões por versão", "alter table erp.tipos_operacao_versao_financeiro drop constraint uq_tipos_operacao_versao_financeiro", UNICAS],
      ["imóvel do movimento sem a empresa na FK", "alter table erp.bank_movements drop constraint fk_bank_movements_imovel_rural, add constraint fk_bank_movements_imovel_rural foreign key (imovel_rural_id, organization_id) references erp.imoveis_rurais (id, organization_id)", FKS],
      ["empresa do imóvel na ordem trocada", "alter table erp.imoveis_rurais drop constraint fk_imoveis_rurais_empresa, add constraint fk_imoveis_rurais_empresa foreign key (empresa_id, organization_id) references erp.empresas (id, organization_id)", FKS],
      ["natureza padrão em cascata", "alter table erp.tipos_operacao_versao_financeiro drop constraint fk_tipos_operacao_versao_financeiro_natureza, add constraint fk_tipos_operacao_versao_financeiro_natureza foreign key (natureza_id, organization_id) references erp.financial_categories (id, organization_id) on delete cascade", FKS],
      ["imóvel da baixa não validado", "alter table erp.title_settlements drop constraint fk_title_settlements_imovel_rural, add constraint fk_title_settlements_imovel_rural foreign key (imovel_rural_id, organization_id) references erp.imoveis_rurais (id, organization_id) not valid", FKS],
      ["TOP do título só pela versão", "alter table erp.financial_titles drop constraint fk_financial_titles_tipo_operacao_versao, add constraint fk_financial_titles_tipo_operacao_versao foreign key (tipo_operacao_versao_id) references erp.tipos_operacao_versoes (id)", FKS],
      ["CHECK do previsto ausente", "alter table erp.financial_titles drop constraint chk_financial_titles_previsto", CHECKS],
      ["CHECK do tipo LCDPR ausente", "alter table erp.financial_categories drop constraint chk_financial_categories_tipo_lcdpr", CHECKS],
      ["situação com um valor a mais", "alter table erp.financial_titles drop constraint financial_titles_status_check, add constraint financial_titles_status_check check (status in ('open', 'partially_paid', 'paid', 'cancelled', 'previsto', 'outro'))", CHECKS],
      ["índice do movimento ausente", "drop index erp.idx_bank_movements_imovel_rural", INDICES],
      ["padrão do imóvel não único", "drop index erp.ux_imoveis_rurais_padrao; create index ux_imoveis_rurais_padrao on erp.imoveis_rurais (organization_id, empresa_id) where padrao and deleted_at is null", INDICES],
      ["índice do previsto inteiro (não parcial)", "drop index erp.idx_financial_titles_previsto_origem; create index idx_financial_titles_previsto_origem on erp.financial_titles (organization_id, source_type, source_id)", INDICES],
      ["guarda do previsto desligada", "alter table erp.financial_titles disable trigger trg_ft_previsto_guarda", GATILHOS],
      ["guarda do previsto sem WHEN", "drop trigger trg_ft_previsto_guarda on erp.financial_titles; create trigger trg_ft_previsto_guarda before update on erp.financial_titles for each row execute function erp.financial_titles_previsto_guarda()", GATILHOS],
      ["guarda do previsto depois (AFTER)", `drop trigger trg_ft_previsto_guarda on erp.financial_titles; create trigger trg_ft_previsto_guarda after update on erp.financial_titles for each row ${GUARDA_WHEN} execute function erp.financial_titles_previsto_guarda()`, GATILHOS],
      ["imutabilidade só de uma coluna", "drop trigger trg_tovf_imutavel on erp.tipos_operacao_versao_financeiro; create trigger trg_tovf_imutavel before update of natureza_id or delete on erp.tipos_operacao_versao_financeiro for each row execute function erp.tipos_operacao_versao_financeiro_imutavel()", GATILHOS],
      ["imutabilidade sem TRUNCATE", "drop trigger trg_tovf_imutavel_truncate on erp.tipos_operacao_versao_financeiro", GATILHOS],
      ["auditoria do imóvel ausente", "drop trigger trg_imoveis_rurais_audit on erp.imoveis_rurais", GATILHOS],
      ["um gatilho a mais no título", "create trigger trg_ft_zz before insert on erp.financial_titles for each row execute function erp.set_updated_at()", GATILHOS],
      ["função de gatilho com EXECUTE do erp_app", "grant execute on function erp.financial_titles_previsto_guarda() to erp_app", FN_GATILHO],
      ["função de gatilho definer", "alter function erp.tipos_operacao_versao_financeiro_imutavel() security definer", FN_GATILHO],
      ["função de gatilho com search_path aberto", "alter function erp.financial_titles_previsto_guarda() set search_path = erp, public", FN_GATILHO],
      ["refresh sem a recusa do previsto (o corpo da 0042)", refresh0042!, REFRESH],
      ["refresh sem EXECUTE do erp_app", "revoke execute on function erp.refresh_title_status(uuid) from public, erp_app", REFRESH],
      ["DELETE no imóvel", "grant delete on erp.imoveis_rurais to erp_app", PRIVILEGIOS],
      ["sem UPDATE no imóvel", "revoke update on erp.imoveis_rurais from erp_app", PRIVILEGIOS],
      ["UPDATE nos padrões", "grant update on erp.tipos_operacao_versao_financeiro to erp_app", PRIVILEGIOS],
      ["TRUNCATE nos padrões", "grant truncate on erp.tipos_operacao_versao_financeiro to erp_app", PRIVILEGIOS]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => t.query(sabotagem))]).toEqual([nome, mensagem]);
    }
    // Nada ficou: o CHECK, a recusa do previsto e os privilégios são os da migration.
    expect(await defDoStatus()).toBe(STATUS_DEPOIS);
    expect(await corpoDoRefresh()).toContain("previsto");
    expect((await db.query<{ d: boolean }>("select has_table_privilege('erp_app', 'erp.imoveis_rurais', 'delete') d")).rows[0]!.d).toBe(false);
  });

  it("DB-6 reaplicar é recusado pela pré-condição 'já aplicada', sem efeito; a trava fica livre", async () => {
    expect(await recusaDa0045()).toBe(JA);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n).toBe(1);
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 79) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });
});
