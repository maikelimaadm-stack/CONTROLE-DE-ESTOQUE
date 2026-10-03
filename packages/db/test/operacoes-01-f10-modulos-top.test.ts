import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A MIGRATION DOS MÓDULOS COM TOP (OPERACOES-01 F10, decisão 287), PROVADA CONTRA O BANCO — SOBRE ACERVO, COMO O RUNNER
 * APLICA.
 *
 * O que ela promete:
 *   · abastecimento, manutenção, ordem de serviço, manejo, batelada e produção de ração ganham o PAR
 *     tipo_operacao_id + tipo_operacao_versao_id (anuláveis, CHECK de par, FKs compostas com a organização); sem TOP,
 *     tudo como hoje;
 *   · o gatilho erp.modulo_top_conferir() confere, com TOP, a FAMÍLIA da tabela (a mesma recusa para outra família,
 *     outra organização e inexistente) e não deixa a TOP mudar depois de gravada;
 *   · erp.maintenances ganha note;
 *   · a política de erp.maintenance_items (uma, `for all`, pelo LOCAL) dá lugar a quatro, uma por comando: ler, alterar
 *     e apagar pela MÁQUINA → MANUTENÇÃO (o item herda o escopo da manutenção, não mais o do local); gravar pela
 *     manutenção E pelo local — nulo (o item sem local passa a gravar) ou visível (a guarda da 0007 continua: o local
 *     de outra organização ou fora do escopo é recusado pelo banco, não só pela API).
 *
 * O NÚMERO da migration NÃO aparece aqui: o coordenador numera na ordem em que as migrations entram na branch e pode
 * renumerar no merge. A alvo é achada pelo SUFIXO do nome (premissa: existe e é única), a trava é lida do SQL dela, e
 * o ledger é contado pela posição dela no disco — nunca por uma contagem fixa.
 *
 * Banco NOVO esconde a prova: sem lançamento gravado, "nenhuma linha muda" seria verdade sobre conjunto vazio. Este
 * arquivo sobe o banco até a migration anterior à alvo, grava ACERVO pelo caminho de antes (uma linha em cada uma das
 * seis tabelas, sem TOP; três manutenções com máquina e item COM local, uma delas com o local de outra empresa) e só
 * então aplica a alvo como o runner aplica (uma transação + ledger), provando antes as recusas dela — a trava, o
 * lock_timeout de 2s e CADA pré-condição quebrada numa transação desfeita, com a SUA mensagem — e depois o
 * comportamento, as pós-condições (só de OBJETOS, cada uma quebrada com a sua mensagem) e a reaplicação recusada.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de RLS,
 * com as GUCs da transação — organização, usuário e o módulo de cada tabela: o caminho que a API percorre). Todo
 * comportamento roda pelo `app`.
 */
let db: Db; let app: Db; let demo: DemoOrg;

const SUFIXO = "_modulos_com_top.sql";
const CANDIDATAS = listMigrations().map((m) => m.name).filter((n) => n.endsWith(SUFIXO));
const ALVO = CANDIDATAS[0] ?? "";
const SQL_ALVO = listMigrations().find((m) => m.name === ALVO)?.sql ?? "";
const TRAVA = Number(/pg_try_advisory_xact_lock\(2026,\s*(\d+)\)/.exec(SQL_ALVO)?.[1] ?? Number.NaN);
const M = "OPERACOES-01 F10: ";

const TABELAS = [
  { nome: "fuel_supplies", familia: "frota_ativos.abastecimento", modulo: "frota_ativos" },
  { nome: "maintenances", familia: "frota_ativos.manutencao", modulo: "frota_ativos" },
  { nome: "service_orders", familia: "ordens_servico.ordem_de_servico", modulo: "ordens_servico" },
  { nome: "animal_handlings", familia: "pecuaria.manejo", modulo: "pecuaria" },
  { nome: "diet_batches", familia: "confinamento.batelada", modulo: "confinamento" },
  { nome: "feed_batches", familia: "estoque.producao_de_racao", modulo: "estoque" }
] as const;
type Tabela = (typeof TABELAS)[number];
type NomeTabela = Tabela["nome"];
const NOMES = TABELAS.map((t) => t.nome);
const PAR = ["tipo_operacao_id", "tipo_operacao_versao_id"];
const tabela = (nome: NomeTabela): Tabela => TABELAS.find((t) => t.nome === nome)!;

const INDISPONIVEL = "VALIDATION_ERROR: Tipo de operação indisponível para este lançamento.";
const IMUTAVEL = "CONFLICT: O tipo de operação do lançamento não muda depois de gravado.";
const JA = `${M}erp.<modulo>.tipo_operacao_id/tipo_operacao_versao_id, erp.maintenances.note, erp.modulo_top_conferir(), gatilho trg_<modulo>_top_conferir ou constraint chk/fk de TOP de modulo ja existe; a migration dos modulos com TOP ja foi aplicada ou ha schema divergente.`;
/** A política que a 0007 gerou para erp.maintenance_items (pelo local de estoque) — o ponto de partida. */
const POLITICA_0007 = "exists (select 1 from erp.warehouses p where p.id = maintenance_items.warehouse_id and erp.tenant_visible(p.organization_id))";
const POLITICA_NOVA = "exists (select 1 from erp.maintenance_machines mm join erp.maintenances p on p.id = mm.maintenance_id where mm.id = maintenance_items.machine_id and erp.tenant_visible(p.organization_id))";
/** A guarda do local na GRAVAÇÃO (insert e update): nulo, ou visível no tenant e no escopo (a pergunta da 0007). */
const GUARDA_DO_LOCAL = "(maintenance_items.warehouse_id is null or exists (select 1 from erp.warehouses w where w.id = maintenance_items.warehouse_id and erp.tenant_visible(w.organization_id)))";
/** As quatro políticas da alvo, pelo nome; o deparse do USING (pela manutenção) e do WITH CHECK (manutenção E local). */
const USING_NOVO = "(EXISTS ( SELECT 1 FROM (erp.maintenance_machines mm JOIN erp.maintenances p ON ((p.id = mm.maintenance_id))) WHERE ((mm.id = maintenance_items.machine_id) AND erp.tenant_visible(p.organization_id))))";
const CHECK_NOVO = "((EXISTS ( SELECT 1 FROM (erp.maintenance_machines mm JOIN erp.maintenances p ON ((p.id = mm.maintenance_id))) WHERE ((mm.id = maintenance_items.machine_id) AND erp.tenant_visible(p.organization_id)))) AND ((warehouse_id IS NULL) OR (EXISTS ( SELECT 1 FROM erp.warehouses w WHERE ((w.id = maintenance_items.warehouse_id) AND erp.tenant_visible(w.organization_id))))))";
const POLITICAS_NOVAS = ["api_child_delete", "api_child_insert", "api_child_select", "api_child_update"];

let A: string; let B: string;
let produto: string; let equipamentoA: string; let equipamentoB: string;
let localA: string; let localA2: string; let localB: string;
let dieta: string; let formula: string; let loteAnimais: string;
let usuarioEscopoA: string;
let outraOrg: string; let itemOutraOrg: string; let maquinaOutraOrg: string; let localOutraOrg: string;

interface Top { top: string; versao: string }
/** Uma TOP por família (a da tabela), mais uma segunda de abastecimento, uma de venda e uma de outra organização. */
const tops = {} as Record<NomeTabela, Top> & { abastecimento2: Top; venda: Top; outraOrg: Top };

let seq = 0;
const codigo = () => `F10-${++seq}`;
const id1 = async (q: Queryable, sql: string, p: unknown[] = []) => (await q.query<{ id: string }>(sql, p)).rows[0]!.id;

/** TOP e versão 1 (na MESMA transação: a FK da versão atual é adiada até o commit), por superusuário. */
async function criarTop(org: string, codigoBase: string): Promise<Top> {
  const n = ++seq;
  return withTx(db, { orgId: org, userId: null }, async (tx) => {
    const top = await id1(tx, "insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id", [org, `F10T${n}`, codigoBase]);
    const versao = await id1(tx, "insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,1,$3) returning id",
      [org, top, `TOP F10 ${codigoBase} ${n}`]);
    return { top, versao };
  });
}
const comTop = (t: Top) => ({ tipo_operacao_id: t.top, tipo_operacao_versao_id: t.versao });

/** As colunas obrigatórias de cada tabela (o que a API grava hoje), na empresa A. */
const BASE: Record<NomeTabela, () => Record<string, unknown>> = {
  fuel_supplies: () => ({ supply_date: "2026-10-01", equipment_id: equipamentoA, warehouse_id: localA, product_id: produto, quantity: "40", unit_value: "6.1", total: "244.00", hour_meter: "1200" }),
  maintenances: () => ({ maintenance_date: "2026-10-01" }),
  service_orders: () => ({ order_date: "2026-10-01", description: "OS F10" }),
  animal_handlings: () => ({ handling_type: "sanitary", handling_date: "2026-10-01", batch_id: loteAnimais, product_id: produto, warehouse_id: localA, quantity: "10", animals_count: 5 }),
  diet_batches: () => ({ batch_date: "2026-10-01", diet_id: dieta, warehouse_id: localA, quantity_kg: "100" }),
  feed_batches: () => ({ batch_date: "2026-10-01", formula_id: formula, origin_warehouse_id: localA, destination_warehouse_id: localA2, quantity_produced: "50" })
};
async function inserir(q: Queryable, nome: NomeTabela, extra: Record<string, unknown> = {}): Promise<string> {
  const v: Record<string, unknown> = { organization_id: demo.orgId, empresa_id: A, code: codigo(), ...BASE[nome](), ...extra };
  const cols = Object.keys(v);
  return id1(q, `insert into erp.${nome} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(v));
}

const ctx = (modulo: string, userId: string = demo.adminUserId): TenantContext => ({ orgId: demo.orgId, userId, modulo });
const naApp = <T>(modulo: string, fn: (tx: Tx) => Promise<T>, userId?: string) => withTx(app, ctx(modulo, userId), fn);
/** O lançamento do módulo pelo papel da aplicação, com o módulo de escopo da tabela. */
const lancar = (nome: NomeTabela, extra: Record<string, unknown> = {}) => naApp(tabela(nome).modulo, (tx) => inserir(tx, nome, extra));
const atualizar = (nome: NomeTabela, id: string, set: string, p: unknown[] = []) =>
  naApp(tabela(nome).modulo, (tx) => tx.query(`update erp.${nome} set ${set} where id=$1`, [id, ...p]));
const topGravada = async (nome: NomeTabela, id: string) => (await db.query<{ top: string | null; versao: string | null }>(
  `select tipo_operacao_id top, tipo_operacao_versao_id versao from erp.${nome} where id=$1`, [id])).rows[0];

/** Manutenção (empresa `empresa`) com UMA máquina e UM item no local `local` (ou sem local), pelo papel da aplicação. */
async function manutencao(empresa: string, equipamento: string, local: string | null): Promise<{ id: string; maquina: string; item: string }> {
  return naApp("frota_ativos", async (tx) => {
    const id = await inserir(tx, "maintenances", { empresa_id: empresa });
    const maquina = await id1(tx, "insert into erp.maintenance_machines (maintenance_id, equipment_id, hour_meter, service_total) values ($1,$2,'1250','300.00') returning id", [id, equipamento]);
    const item = await id1(tx, "insert into erp.maintenance_items (machine_id, warehouse_id, product_id, quantity, unit_value, total) values ($1,$2,$3,'2','15.5','31.00') returning id",
      [maquina, local, produto]);
    return { id, maquina, item };
  });
}
/** Os itens de manutenção que `userId` vê pelo papel da aplicação, no módulo da frota. */
const itensVisiveis = (userId: string = demo.adminUserId) => naApp("frota_ativos", async (tx) =>
  (await tx.query<{ id: string }>("select id from erp.maintenance_items order by id")).rows.map((r) => r.id), userId);

interface ErroPg { code?: string; constraint?: string; message: string }
async function erroDe(p: Promise<unknown>): Promise<ErroPg> {
  try { await p; } catch (e) { return e as ErroPg; }
  throw new Error("esperava recusa, e o banco aceitou");
}

async function aplicar(): Promise<void> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(SQL_ALVO);
    await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
/** Roda `sql` numa transação DESFEITA no fim (depois de `antes`), e devolve a mensagem do erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a recusa, e o SQL aplicou");
}
const recusaDaAlvo = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(SQL_ALVO, antes);
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
const colunasNovasQueExistem = async () => (await db.query<{ c: string }>(
  `select table_name || '.' || column_name c from information_schema.columns
    where table_schema='erp' and ((table_name::text = any($1::text[]) and column_name::text = any($2::text[])) or (table_name='maintenances' and column_name='note'))
    order by 1`, [NOMES, PAR])).rows.map((r) => r.c);
const funcaoExiste = async () => (await db.query<{ ok: boolean }>("select to_regprocedure('erp.modulo_top_conferir()') is not null ok")).rows[0]!.ok;
const gatilhosDaTop = async () => (await db.query<{ tgname: string }>(
  "select tgname from pg_trigger where not tgisinternal and tgname like 'trg\\_%\\_top\\_conferir' order by tgname collate \"C\"")).rows.map((r) => r.tgname);
/** A política de erp.maintenance_items, com os espaços normalizados. */
const politicaDosItens = async () => (await db.query<{ policyname: string; roles: string[]; cmd: string; qual: string; with_check: string }>(
  `select policyname, roles::text[] roles, cmd, regexp_replace(qual, '\\s+', ' ', 'g') qual, regexp_replace(with_check, '\\s+', ' ', 'g') with_check
     from pg_policies where schemaname='erp' and tablename='maintenance_items' order by policyname`)).rows;

/** O ACERVO, linha a linha, sem as colunas novas (antes da alvo elas nem existem; depois, são nulas — conferido à parte). */
async function retrato(): Promise<Record<string, unknown[]>> {
  const r: Record<string, unknown[]> = {};
  for (const t of [...NOMES, "maintenance_machines", "maintenance_items"]) {
    const tirar = t === "maintenances" ? [...PAR, "note"] : (NOMES as readonly string[]).includes(t) ? PAR : [];
    r[t] = (await db.query<{ l: unknown }>(`select to_jsonb(x) - $1::text[] l from erp.${t} x order by id`, [tirar])).rows.map((x) => x.l);
  }
  return r;
}
let antes: Record<string, unknown[]>;
const acervo = {} as Record<NomeTabela, string> & {
  manutencaoA: { id: string; maquina: string; item: string };
  manutencaoCruzada: { id: string; maquina: string; item: string };
  manutencaoB: { id: string; maquina: string; item: string };
};

beforeAll(async () => {
  if (CANDIDATAS.length !== 1) throw new Error(`premissa: exatamente uma migration *${SUFIXO} no disco, e há ${CANDIDATAS.length}: ${CANDIDATAS.join(", ")}`);
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < ALVO)) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });

  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  produto = await id1(db, "select id from erp.products where organization_id=$1 and deleted_at is null order by code limit 1", [demo.orgId]);
  equipamentoA = await id1(db, "select id from erp.equipments where organization_id=$1 and empresa_id=$2 order by code limit 1", [demo.orgId, A]);
  equipamentoB = await id1(db, "insert into erp.equipments (organization_id, empresa_id, code, description) values ($1,$2,'F10-EB','[TEST] Trator da empresa B') returning id", [demo.orgId, B]);
  const local = (empresa: string, sigla: string) => id1(db, "select id from erp.warehouses where organization_id=$1 and empresa_id=$2 and initials=$3", [demo.orgId, empresa, sigla]);
  localA = await local(A, "ALM"); localA2 = await local(A, "FAB"); localB = await local(B, "ALM");
  dieta = await id1(db, "select id from erp.diets where organization_id=$1 order by code limit 1", [demo.orgId]);
  formula = await id1(db, "insert into erp.feed_formulas (organization_id, code, name) values ($1,'F10-FR','[TEST] Fórmula F10') returning id", [demo.orgId]);
  loteAnimais = await id1(db, "select id from erp.batches where organization_id=$1 and empresa_id=$2 order by code limit 1", [demo.orgId, A]);

  for (const t of TABELAS) tops[t.nome] = await criarTop(demo.orgId, t.familia);
  tops.abastecimento2 = await criarTop(demo.orgId, "frota_ativos.abastecimento");
  tops.venda = await criarTop(demo.orgId, "vendas.pedido");

  // Outra organização: uma TOP de abastecimento e uma manutenção com máquina e item (sem local), por superusuário.
  outraOrg = await id1(db, "insert into erp.organizations (name, slug) values ('[TEST] Outra F10','outra-f10') returning id");
  const empresaOutra = await id1(db, "insert into erp.empresas (organization_id, code, name) values ($1, 95, '[TEST] Empresa outra org F10') returning id", [outraOrg]);
  tops.outraOrg = await criarTop(outraOrg, "frota_ativos.abastecimento");
  const equipamentoOutra = await id1(db, "insert into erp.equipments (organization_id, empresa_id, code, description) values ($1,$2,'F10-EO','[TEST] Trator outra org') returning id", [outraOrg, empresaOutra]);
  const manutencaoOutra = await id1(db, "insert into erp.maintenances (organization_id, empresa_id, code, maintenance_date) values ($1,$2,'F10-MO','2026-10-01') returning id", [outraOrg, empresaOutra]);
  maquinaOutraOrg = await id1(db, "insert into erp.maintenance_machines (maintenance_id, equipment_id) values ($1,$2) returning id", [manutencaoOutra, equipamentoOutra]);
  itemOutraOrg = await id1(db, "insert into erp.maintenance_items (machine_id, product_id, quantity) values ($1,$2,'1') returning id", [maquinaOutraOrg, produto]);
  localOutraOrg = await id1(db, "insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,'F10O','[TEST] Local outra org F10') returning id", [outraOrg, empresaOutra]);

  // Membro com escopo SELECIONADAS = [A] no módulo da frota (e nada nos outros: fail-closed).
  usuarioEscopoA = await id1(db, "insert into erp.users (email, name, password_hash) values ('f10-a@demo.local','F10 A','x') returning id");
  const membro = await id1(db, "insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuarioEscopoA]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'frota_ativos','selecionadas')", [demo.orgId, membro]);
  await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'frota_ativos','selecionadas',$3)", [demo.orgId, membro, A]);

  // O ACERVO, pelo caminho de antes (papel da aplicação, o módulo de cada tabela, sem TOP).
  for (const t of NOMES) acervo[t] = await lancar(t);
  acervo.manutencaoA = await manutencao(A, equipamentoA, localA);
  acervo.manutencaoCruzada = await manutencao(A, equipamentoA, localB);
  acervo.manutencaoB = await manutencao(B, equipamentoB, localA);
  antes = await retrato();
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("U — a migration dos módulos com TOP sobre o acervo, como o runner aplica", () => {
  it("U0 PREMISSA: a alvo é única e tem trava; o banco está em todas as anteriores a ela, sem os objetos dela; o acervo está gravado; a política de antes recusa o item sem local e segue o escopo do LOCAL", async () => {
    expect(CANDIDATAS, `uma só migration *${SUFIXO}`).toHaveLength(1);
    expect(Number.isInteger(TRAVA) && TRAVA > 0, "a trava (2026,N) está no SQL da alvo").toBe(true);
    const noDisco = listMigrations().map((m) => m.name);
    const posicao = noDisco.indexOf(ALVO);
    expect(posicao, "a alvo vem depois da que criou a chave (id, tipo_operacao_id, organization_id) da versão da TOP").toBeGreaterThan(noDisco.indexOf("0021_sales_document_tipo_operacao.sql"));
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger, "todas as anteriores à alvo, e só elas").toEqual({ n: posicao, ultima: noDisco[posicao - 1] });
    expect(await noLedger()).toBe(false);
    expect(await colunasNovasQueExistem()).toEqual([]);
    expect(await funcaoExiste()).toBe(false);
    expect(await gatilhosDaTop()).toEqual([]);
    expect(await politicaDosItens()).toEqual([{ policyname: "api_child", roles: ["erp_app"], cmd: "ALL",
      qual: "(EXISTS ( SELECT 1 FROM erp.warehouses p WHERE ((p.id = maintenance_items.warehouse_id) AND erp.tenant_visible(p.organization_id))))",
      with_check: "(EXISTS ( SELECT 1 FROM erp.warehouses p WHERE ((p.id = maintenance_items.warehouse_id) AND erp.tenant_visible(p.organization_id))))" }]);
    // Sem acervo, "nenhuma linha muda" seria verdade sobre conjunto vazio.
    expect(Object.fromEntries(Object.entries(antes).map(([t, l]) => [t, l.length]))).toEqual({
      fuel_supplies: 1, maintenances: 5, service_orders: 1, animal_handlings: 1, diet_batches: 1, feed_batches: 1, maintenance_machines: 4, maintenance_items: 4
    });
    // A política de antes: o item sem local é recusado pela RLS (a correlação era pelo local de estoque)…
    const semLocal = await erroDe(manutencao(A, equipamentoA, null));
    expect([semLocal.code, semLocal.message]).toEqual(["42501", 'new row violates row-level security policy for table "maintenance_items"']);
    // …e o item segue o escopo do LOCAL: com escopo [A] na frota, o membro vê o item da manutenção de B (local em A)
    // e NÃO vê o item da manutenção de A com local em B. O dono vê os três da organização (o da outra, nunca).
    expect((await itensVisiveis(usuarioEscopoA)).sort()).toEqual([acervo.manutencaoA.item, acervo.manutencaoB.item].sort());
    expect((await itensVisiveis()).sort()).toEqual([acervo.manutencaoA.item, acervo.manutencaoCruzada.item, acervo.manutencaoB.item].sort());
    const manutencoesDoMembro = await naApp("frota_ativos", async (tx) => (await tx.query<{ id: string }>("select id from erp.maintenances order by id")).rows.map((r) => r.id), usuarioEscopoA);
    expect(manutencoesDoMembro.sort(), "premissa do escopo: o membro vê só as manutenções de A").toEqual(
      [acervo.maintenances, acervo.manutencaoA.id, acervo.manutencaoCruzada.id].sort());
  });

  it("U2.1 trava em uso por outra sessão: a alvo recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, $1)", [TRAVA]);
      await expect(aplicar()).rejects.toThrow(`${M}outra transacao ja detem a trava desta migration (2026,${TRAVA}). Nada foi aplicado.`);
    } finally { await outra.query("select pg_advisory_unlock(2026, $1)", [TRAVA]); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await colunasNovasQueExistem()).toEqual([]);
  });

  it("U2.2 lock_timeout 2s: a alvo o fixa na própria transação, e uma leitura aberta em erp.fuel_supplies a faz desistir em ~2s, sem efeito", async () => {
    const linha = "set local lock_timeout = '2s';";
    expect(SQL_ALVO).toContain(linha);
    // Lido de dentro da aplicação: o trecho da alvo até o `set local` (a trava e nada mais), e o valor na transação.
    const c = await db.connect();
    try {
      await c.query("begin");
      const antesDoSet = (await c.query<{ v: string }>("select current_setting('lock_timeout') v")).rows[0]!.v;
      await c.query(SQL_ALVO.slice(0, SQL_ALVO.indexOf(linha) + linha.length));
      const depois = (await c.query<{ v: string }>("select current_setting('lock_timeout') v")).rows[0]!.v;
      expect([antesDoSet, depois]).toEqual(["0", "2s"]);
    } finally { await c.query("rollback"); c.release(); }
    const leitor = await db.connect();
    try {
      await leitor.query("begin");
      await leitor.query("select 1 from erp.fuel_supplies limit 1");   // AccessShare: o ALTER TABLE precisa de AccessExclusive
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await leitor.query("rollback"); leitor.release(); }
    expect(await noLedger()).toBe(false);
    expect(await colunasNovasQueExistem()).toEqual([]);
  });

  it("U2.3 reversas: cada pré-condição quebrada recusa a alvo com a SUA mensagem, sem efeito", async () => {
    // "Já aplicada": qualquer objeto que ela cria — cada coluna, a função, cada gatilho, as constraints.
    const jaAplicada: [string, string][] = [];
    for (const t of NOMES) for (const col of PAR) jaAplicada.push([`${t}.${col}`, `alter table erp.${t} add column ${col} uuid`]);
    jaAplicada.push(["maintenances.note", "alter table erp.maintenances add column note text"]);
    jaAplicada.push(["função", "create function erp.modulo_top_conferir() returns trigger language plpgsql as 'begin return new; end'"]);
    for (const t of NOMES) jaAplicada.push([`gatilho de ${t}`, `create trigger trg_${t}_top_conferir after insert on erp.${t} for each row execute function erp.audit_row()`]);
    jaAplicada.push(["CHECK de par", "alter table erp.diet_batches add constraint chk_diet_batches_tipo_operacao_par check (true)"]);
    jaAplicada.push(["FK da TOP", "alter table erp.service_orders add constraint fk_service_orders_tipo_operacao foreign key (organization_id) references erp.organizations (id)"]);
    jaAplicada.push(["FK da versão", "alter table erp.feed_batches add constraint fk_feed_batches_tipo_operacao_versao foreign key (organization_id) references erp.organizations (id)"]);
    for (const [nome, sabotagem] of jaAplicada) {
      expect([nome, await recusaDaAlvo((c) => c.query(sabotagem))]).toEqual([nome, JA]);
    }
    // "Já aplicada" vem ANTES de todas: com o papel, a chave e a política quebrados JUNTO, o motivo dito é o verdadeiro.
    expect(await recusaDaAlvo(async (c) => {
      await c.query("alter role erp_app rename to erp_app_f10");
      await c.query("alter table erp.tipos_operacao rename constraint uq_tipos_operacao_tenant to uq_f10_x");
      await c.query("drop policy api_child on erp.maintenance_items");
      await c.query("alter table erp.animal_handlings add column tipo_operacao_versao_id uuid");
    })).toBe(JA);

    const PAPEL = `${M}papel erp_app ou erp.tenant_visible(uuid) ausente (0007); a politica nova nao teria destinatario.`;
    const TABELA = `${M}tabela de modulo ausente ou sem organization_id (fuel_supplies, maintenances, service_orders, animal_handlings, diet_batches, feed_batches); a cadeia de migrations esta fora de ordem.`;
    const CHAVE = `${M}chave alvo das FKs da TOP ausente ou fora da ordem (uq_tipos_operacao_tenant (id, organization_id) da 0020, uq_tipos_operacao_versoes_tenant (id, tipo_operacao_id, organization_id) da 0021) ou erp.tipos_operacao.codigo_base ausente; a cadeia de migrations esta fora de ordem.`;
    const POLITICA = `${M}a politica de erp.maintenance_items nao e a da 0007 (correlacao pelo local de estoque); schema divergente, a decisao volta para um humano.`;
    const trocarPolitica = (para: string, using: string, check: string) =>
      `drop policy api_child on erp.maintenance_items; create policy api_child on erp.maintenance_items for all to ${para} using (${using}) with check (${check})`;
    const casos: [string, string, string][] = [
      ["papel da aplicação ausente", "alter role erp_app rename to erp_app_f10", PAPEL],
      ["tenant_visible ausente", "alter function erp.tenant_visible(uuid) rename to tenant_visible_f10", PAPEL],
      ...NOMES.map((t): [string, string, string] => [`tabela ${t} ausente`, `alter table erp.${t} rename to ${t}_f10`, TABELA]),
      ["organization_id ausente", "alter table erp.diet_batches rename column organization_id to organizacao_f10", TABELA],
      ["organization_id anulável", "alter table erp.service_orders alter column organization_id drop not null", TABELA],
      ["chave da TOP ausente", "alter table erp.tipos_operacao rename constraint uq_tipos_operacao_tenant to uq_f10_x", CHAVE],
      ["chave da versão ausente", "alter table erp.tipos_operacao_versoes rename constraint uq_tipos_operacao_versoes_tenant to uq_f10_x", CHAVE],
      ["chave da TOP fora da ordem", "alter table erp.tipos_operacao drop constraint uq_tipos_operacao_tenant cascade; alter table erp.tipos_operacao add constraint uq_tipos_operacao_tenant unique (organization_id, id)", CHAVE],
      ["chave da versão fora da ordem", "alter table erp.tipos_operacao_versoes drop constraint uq_tipos_operacao_versoes_tenant cascade; alter table erp.tipos_operacao_versoes add constraint uq_tipos_operacao_versoes_tenant unique (id, organization_id, tipo_operacao_id)", CHAVE],
      ["família da TOP ausente", "alter table erp.tipos_operacao rename column codigo_base to familia_f10", CHAVE],
      ["política trocada por outra", trocarPolitica("erp_app", "true", "true"), POLITICA],
      ["política já pela máquina", trocarPolitica("erp_app", POLITICA_NOVA, POLITICA_NOVA), POLITICA],
      ["política da 0007 também para authenticated", trocarPolitica("erp_app, authenticated", POLITICA_0007, POLITICA_0007), POLITICA],
      ["política da 0007 com outro with check", trocarPolitica("erp_app", POLITICA_0007, "true"), POLITICA],
      ["uma política a mais", "create policy f10_extra on erp.maintenance_items for select to erp_app using (true)", POLITICA],
      ["sem política", "drop policy api_child on erp.maintenance_items", POLITICA],
      ["machine_id ausente", "alter table erp.maintenance_items rename column machine_id to maquina_f10", POLITICA],
      ["maintenance_machines.maintenance_id ausente", "alter table erp.maintenance_machines rename column maintenance_id to manutencao_f10", POLITICA],
      ["warehouses.organization_id ausente (a guarda do local)", "alter table erp.warehouses rename column organization_id to organizacao_f10", POLITICA]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDaAlvo((c) => c.query(sabotagem))]).toEqual([nome, mensagem]);
    }
    // Nada ficou: o ledger, as colunas, a função, os gatilhos, a política de antes, o papel e a função da RLS.
    expect(await noLedger()).toBe(false);
    expect(await colunasNovasQueExistem()).toEqual([]);
    expect(await funcaoExiste()).toBe(false);
    expect(await gatilhosDaTop()).toEqual([]);
    expect((await politicaDosItens()).map((p) => p.qual)).toEqual(["(EXISTS ( SELECT 1 FROM erp.warehouses p WHERE ((p.id = maintenance_items.warehouse_id) AND erp.tenant_visible(p.organization_id))))"]);
    expect((await db.query("select 1 from pg_roles where rolname='erp_app'")).rowCount).toBe(1);
    expect((await db.query<{ ok: boolean }>("select to_regprocedure('erp.tenant_visible(uuid)') is not null ok")).rows[0]!.ok).toBe(true);
  });

  it("U1 aplica: ledger com a alvo por último, acervo IDÊNTICO linha a linha, colunas novas nulas no acervo e trava liberada", async () => {
    const noDisco = listMigrations().map((m) => m.name);
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: noDisco.indexOf(ALVO) + 1, ultima: ALVO });
    expect(await retrato(), "nenhuma linha dos seis módulos, das máquinas ou dos itens de manutenção muda").toEqual(antes);
    for (const t of NOMES) {
      const extra = t === "maintenances" ? " or note is not null" : "";
      const r = (await db.query<{ n: number; preenchidas: number }>(
        `select count(*)::int n, count(*) filter (where tipo_operacao_id is not null or tipo_operacao_versao_id is not null${extra})::int preenchidas from erp.${t}`)).rows[0]!;
      expect([t, r], "o acervo, nenhuma coluna nova preenchida (sem backfill)").toEqual([t, { n: antes[t]!.length, preenchidas: 0 }]);
    }
    // A trava é de transação: depois do commit, outra sessão a obtém.
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, $1) ok", [TRAVA])).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("U1b catálogo como o contrato: colunas comentadas, CHECKs, FKs compostas, nenhum índice novo, a função, os seis gatilhos e as quatro políticas dos itens", async () => {
    const colunas = (await db.query<{ c: string }>(
      `select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') c from information_schema.columns
        where table_schema='erp' and ((table_name::text = any($1::text[]) and column_name::text = any($2::text[])) or (table_name='maintenances' and column_name='note'))
      `, [NOMES, PAR])).rows.map((r) => r.c).sort();
    expect(colunas).toEqual(NOMES.flatMap((t) => (t === "maintenances" ? [`${t}.note:text:YES:-`] : []).concat(PAR.map((c) => `${t}.${c}:uuid:YES:-`))).sort());
    const semComentario = (await db.query<{ c: string }>(
      `select a.attrelid::regclass::text || '.' || a.attname c from pg_attribute a
        where a.attrelid = any((select array_agg(to_regclass('erp.' || n)) from unnest($1::text[]) n)::regclass[])
          and (a.attname::text = any($2::text[]) or (a.attrelid = 'erp.maintenances'::regclass and a.attname = 'note'))
          and col_description(a.attrelid, a.attnum) is null`, [NOMES, PAR])).rows;
    expect(semComentario).toEqual([]);
    const defs = (await db.query<{ t: string; conname: string; def: string; validada: boolean }>(
      `select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def, convalidated validada from pg_constraint
        where conrelid = any((select array_agg(to_regclass('erp.' || n)) from unnest($1::text[]) n)::regclass[]) and conname like '%tipo\\_operacao%'
        order by conname collate "C"`, [NOMES])).rows;
    expect(defs).toEqual([...NOMES].flatMap((t) => [
      { t: `erp.${t}`, conname: `chk_${t}_tipo_operacao_par`, def: "CHECK (((tipo_operacao_id IS NULL) = (tipo_operacao_versao_id IS NULL)))", validada: true },
      { t: `erp.${t}`, conname: `fk_${t}_tipo_operacao`, def: "FOREIGN KEY (tipo_operacao_id, organization_id) REFERENCES erp.tipos_operacao(id, organization_id)", validada: true },
      { t: `erp.${t}`, conname: `fk_${t}_tipo_operacao_versao`, def: "FOREIGN KEY (tipo_operacao_versao_id, tipo_operacao_id, organization_id) REFERENCES erp.tipos_operacao_versoes(id, tipo_operacao_id, organization_id)", validada: true }
    ]).sort((x, y) => (x.conname < y.conname ? -1 : x.conname > y.conname ? 1 : 0)));
    expect((await db.query("select 1 from pg_indexes where schemaname='erp' and tablename = any($1::text[]) and indexdef like '%tipo_operacao%'", [NOMES])).rowCount,
      "sem índice novo (declarado: nenhuma consulta dos módulos filtra pela TOP)").toBe(0);
    const fn = (await db.query<{ definer: boolean; vol: string; cfg: string[]; app: boolean; publico: boolean; comentada: boolean }>(
      `select p.prosecdef definer, p.provolatile vol, p.proconfig cfg, has_function_privilege('erp_app', p.oid, 'execute') app,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) publico,
              obj_description(p.oid, 'pg_proc') is not null comentada
         from pg_proc p where p.oid = 'erp.modulo_top_conferir()'::regprocedure`)).rows;
    expect(fn).toEqual([{ definer: false, vol: "v", cfg: ["search_path=erp, pg_temp"], app: false, publico: false, comentada: true }]);
    const gatilhos = (await db.query<{ def: string }>(
      `select pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and tgenabled = 'O'
          and tgrelid = any((select array_agg(to_regclass('erp.' || n)) from unnest($1::text[]) n)::regclass[]) order by tgname collate "C"`, [NOMES])).rows.map((r) => r.def);
    expect(gatilhos, "um gatilho por tabela, e só ele").toEqual([...TABELAS].sort((x, y) => (x.nome < y.nome ? -1 : 1)).map((t) =>
      `CREATE TRIGGER trg_${t.nome}_top_conferir BEFORE INSERT OR UPDATE OF tipo_operacao_id, tipo_operacao_versao_id ON erp.${t.nome} FOR EACH ROW EXECUTE FUNCTION erp.modulo_top_conferir('${t.familia}')`));
    // Uma política por comando: ler, alterar e apagar pela manutenção (sem o local); gravar pela manutenção E pelo local.
    expect(await politicaDosItens()).toEqual([
      { policyname: "api_child_delete", roles: ["erp_app"], cmd: "DELETE", qual: USING_NOVO, with_check: null },
      { policyname: "api_child_insert", roles: ["erp_app"], cmd: "INSERT", qual: null, with_check: CHECK_NOVO },
      { policyname: "api_child_select", roles: ["erp_app"], cmd: "SELECT", qual: USING_NOVO, with_check: null },
      { policyname: "api_child_update", roles: ["erp_app"], cmd: "UPDATE", qual: USING_NOVO, with_check: CHECK_NOVO }
    ]);
    const rls = (await db.query<{ t: string; ok: boolean; comentadas: number }>(
      `select c.oid::regclass::text t, c.relrowsecurity and c.relforcerowsecurity ok,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid and p.polname = any($1::text[]) and obj_description(p.oid, 'pg_policy') is not null) comentadas
         from pg_class c where c.oid = 'erp.maintenance_items'::regclass`, [POLITICAS_NOVAS])).rows;
    expect(rls).toEqual([{ t: "erp.maintenance_items", ok: true, comentadas: 4 }]);
  });
});

describe("U3 — comportamento depois da migration (papel da aplicação, módulo de cada tabela)", () => {
  it("(a)(b) abastecimento: TOP da família certa grava o par; de outra família, de outra organização ou inexistente, a MESMA recusa", async () => {
    const id = await lancar("fuel_supplies", comTop(tops.fuel_supplies));
    expect(await topGravada("fuel_supplies", id)).toEqual({ top: tops.fuel_supplies.top, versao: tops.fuel_supplies.versao });
    for (const [nome, t] of [["outra família (manutenção)", tops.maintenances], ["família de venda", tops.venda], ["outra organização", tops.outraOrg],
      ["inexistente", { top: randomUUID(), versao: randomUUID() }]] as [string, Top][]) {
      const e = await erroDe(lancar("fuel_supplies", comTop(t)));
      expect([nome, e.code, e.message]).toEqual([nome, "P0001", INDISPONIVEL]);
    }
    // Premissa da recusa da outra organização: a TOP existe (o superusuário a vê), e é de abastecimento.
    expect((await db.query("select 1 from erp.tipos_operacao where id=$1 and codigo_base='frota_ativos.abastecimento'", [tops.outraOrg.top])).rowCount).toBe(1);
  });

  it("(c)(d) só um dos dois ponteiros: o CHECK de par (23514); a versão de OUTRA TOP da mesma família: a FK composta (23503)", async () => {
    for (const [nome, par] of [["só a TOP", { tipo_operacao_id: tops.fuel_supplies.top }], ["só a versão", { tipo_operacao_versao_id: tops.fuel_supplies.versao }]] as const) {
      const e = await erroDe(lancar("fuel_supplies", par));
      expect([nome, e.code, e.constraint]).toEqual([nome, "23514", "chk_fuel_supplies_tipo_operacao_par"]);
    }
    const e = await erroDe(lancar("fuel_supplies", { tipo_operacao_id: tops.fuel_supplies.top, tipo_operacao_versao_id: tops.abastecimento2.versao }));
    expect([e.code, e.constraint]).toEqual(["23503", "fk_fuel_supplies_tipo_operacao_versao"]);
    // Premissa: as duas TOPs são da família certa (o gatilho deixou passar; quem recusou foi a FK).
    expect((await db.query<{ f: string }>("select codigo_base f from erp.tipos_operacao where id = any($1::uuid[])", [[tops.fuel_supplies.top, tops.abastecimento2.top]])).rows)
      .toEqual([{ f: "frota_ativos.abastecimento" }, { f: "frota_ativos.abastecimento" }]);
  });

  it("(e) a TOP gravada não muda (nem some, nem troca, nem nasce depois); a outra coluna da linha com TOP muda; regravar a MESMA TOP passa", async () => {
    const id = await lancar("fuel_supplies", comTop(tops.fuel_supplies));
    for (const [nome, set, p] of [
      ["troca pela outra TOP da família", "tipo_operacao_id=$2, tipo_operacao_versao_id=$3", [tops.abastecimento2.top, tops.abastecimento2.versao]],
      ["tira a TOP", "tipo_operacao_id=null, tipo_operacao_versao_id=null", []],
      ["só a versão", "tipo_operacao_versao_id=$2", [tops.abastecimento2.versao]]
    ] as [string, string, unknown[]][]) {
      const e = await erroDe(atualizar("fuel_supplies", id, set, p));
      expect([nome, e.code, e.message]).toEqual([nome, "P0001", IMUTAVEL]);
    }
    // O lançamento de antes (sem TOP) não ganha TOP depois.
    const e = await erroDe(atualizar("fuel_supplies", acervo.fuel_supplies, "tipo_operacao_id=$2, tipo_operacao_versao_id=$3", [tops.fuel_supplies.top, tops.fuel_supplies.versao]));
    expect([e.code, e.message]).toEqual(["P0001", IMUTAVEL]);
    await expect(atualizar("fuel_supplies", id, "note=$2, status='cancelled'", ["Cancelado no teste"])).resolves.toMatchObject({ rowCount: 1 });
    await expect(atualizar("fuel_supplies", id, "tipo_operacao_id=$2, tipo_operacao_versao_id=$3", [tops.fuel_supplies.top, tops.fuel_supplies.versao])).resolves.toMatchObject({ rowCount: 1 });
    expect(await topGravada("fuel_supplies", id)).toEqual({ top: tops.fuel_supplies.top, versao: tops.fuel_supplies.versao });
    expect(await topGravada("fuel_supplies", acervo.fuel_supplies)).toEqual({ top: null, versao: null });
  });

  it("(f) item de manutenção SEM local grava e é visível; o item segue o escopo da MANUTENÇÃO; o item de outra organização é invisível e não recebe item", async () => {
    const semLocal = await manutencao(A, equipamentoA, null);
    expect((await itensVisiveis()).includes(semLocal.item), "o item sem local, gravado pela política nova, é visível").toBe(true);
    expect((await db.query<{ local: string | null }>("select warehouse_id local from erp.maintenance_items where id=$1", [semLocal.item])).rows).toEqual([{ local: null }]);
    // Escopo [A] na frota: agora vê o item da manutenção de A com local em B, e NÃO o da manutenção de B com local em A.
    const doMembro = await itensVisiveis(usuarioEscopoA);
    expect([doMembro.includes(acervo.manutencaoA.item), doMembro.includes(acervo.manutencaoCruzada.item), doMembro.includes(acervo.manutencaoB.item), doMembro.includes(semLocal.item)])
      .toEqual([true, true, false, true]);
    // A manutenção de B nem recebe item de quem não a vê (o with check contém a pergunta da leitura).
    const e = await erroDe(naApp("frota_ativos", (tx) => tx.query("insert into erp.maintenance_items (machine_id, warehouse_id, product_id, quantity) values ($1,$2,$3,'1')",
      [acervo.manutencaoB.maquina, localA, produto]), usuarioEscopoA));
    expect([e.code, e.message]).toEqual(["42501", 'new row violates row-level security policy for table "maintenance_items"']);
    // Outra organização: o item existe (o superusuário o vê), a aplicação não o vê e não grava na máquina dela.
    expect((await db.query("select 1 from erp.maintenance_items where id=$1", [itemOutraOrg])).rowCount).toBe(1);
    expect((await itensVisiveis()).includes(itemOutraOrg)).toBe(false);
    expect((await naApp("frota_ativos", (tx) => tx.query("select 1 from erp.maintenance_items where id=$1", [itemOutraOrg]))).rowCount).toBe(0);
    const outra = await erroDe(naApp("frota_ativos", (tx) => tx.query("insert into erp.maintenance_items (machine_id, product_id, quantity) values ($1,$2,'1')", [maquinaOutraOrg, produto])));
    expect([outra.code, outra.message]).toEqual(["42501", 'new row violates row-level security policy for table "maintenance_items"']);
  });

  it("(f1) a guarda do LOCAL na gravação: o local de outra organização e o local fora do escopo são recusados no insert e no update; o local visível e o nulo gravam; apagar segue a leitura", async () => {
    const recusaRls = 'new row violates row-level security policy for table "maintenance_items"';
    // Premissas: o local da outra organização existe (o superusuário o vê) e a FK de coluna única o aceitaria.
    expect((await db.query("select 1 from erp.warehouses where id=$1 and organization_id=$2", [localOutraOrg, outraOrg])).rowCount).toBe(1);
    expect((await db.query<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='erp.maintenance_items'::regclass and contype='f' and conkey = array[(select attnum from pg_attribute where attrelid='erp.maintenance_items'::regclass and attname='warehouse_id')]::int2[]")).rows)
      .toEqual([{ def: "FOREIGN KEY (warehouse_id) REFERENCES erp.warehouses(id)" }]);
    const inserirItem = (maquina: string, local: string | null, userId?: string) => naApp("frota_ativos", (tx) =>
      tx.query("insert into erp.maintenance_items (machine_id, warehouse_id, product_id, quantity) values ($1,$2,$3,'1')", [maquina, local, produto]), userId);
    // INSERT: o dono (todas as empresas) na manutenção de A — local de outra organização recusado; o de A e o nulo gravam.
    const alheio = await erroDe(inserirItem(acervo.manutencaoA.maquina, localOutraOrg));
    expect([alheio.code, alheio.message]).toEqual(["42501", recusaRls]);
    await expect(inserirItem(acervo.manutencaoA.maquina, localA)).resolves.toMatchObject({ rowCount: 1 });
    await expect(inserirItem(acervo.manutencaoA.maquina, null)).resolves.toMatchObject({ rowCount: 1 });
    // O membro com escopo [A] na frota: na manutenção de A (que ele vê), o local de B (fora do escopo) é recusado; o de A grava.
    const foraDoEscopo = await erroDe(inserirItem(acervo.manutencaoA.maquina, localB, usuarioEscopoA));
    expect([foraDoEscopo.code, foraDoEscopo.message]).toEqual(["42501", recusaRls]);
    await expect(inserirItem(acervo.manutencaoA.maquina, localA, usuarioEscopoA)).resolves.toMatchObject({ rowCount: 1 });
    // UPDATE: o item sem local não passa a apontar o local de outra organização; passa ao local de A.
    const item = (await manutencao(A, equipamentoA, null)).item;
    const trocar = (local: string) => naApp("frota_ativos", (tx) => tx.query("update erp.maintenance_items set warehouse_id=$2 where id=$1", [item, local]));
    const troca = await erroDe(trocar(localOutraOrg));
    expect([troca.code, troca.message]).toEqual(["42501", recusaRls]);
    await expect(trocar(localA)).resolves.toMatchObject({ rowCount: 1 });
    expect((await db.query<{ local: string | null }>("select warehouse_id local from erp.maintenance_items where id=$1", [item])).rows).toEqual([{ local: localA }]);
    // DELETE segue a leitura: o membro não apaga o item da manutenção de B (zero linha), e o item continua lá.
    expect((await naApp("frota_ativos", (tx) => tx.query("delete from erp.maintenance_items where id=$1", [acervo.manutencaoB.item]), usuarioEscopoA)).rowCount).toBe(0);
    expect((await db.query("select 1 from erp.maintenance_items where id=$1", [acervo.manutencaoB.item])).rowCount).toBe(1);
  });

  it("(f2) a observação da manutenção grava e volta (a coluna nova)", async () => {
    const id = await naApp("frota_ativos", (tx) => inserir(tx, "maintenances", { note: "Troca de óleo e filtros" }));
    expect((await db.query<{ note: string }>("select note from erp.maintenances where id=$1", [id])).rows).toEqual([{ note: "Troca de óleo e filtros" }]);
  });

  it("(g) nas seis tabelas: sem TOP grava como hoje; a TOP da família da tabela grava; a de outra família recusa; a gravada não muda", async () => {
    for (const [i, t] of TABELAS.entries()) {
      const semTop = await lancar(t.nome);
      expect([t.nome, await topGravada(t.nome, semTop)]).toEqual([t.nome, { top: null, versao: null }]);
      const id = await lancar(t.nome, comTop(tops[t.nome]));
      expect([t.nome, await topGravada(t.nome, id)]).toEqual([t.nome, { top: tops[t.nome].top, versao: tops[t.nome].versao }]);
      const vizinha = TABELAS[(i + 1) % TABELAS.length]!;
      const errada = await erroDe(lancar(t.nome, comTop(tops[vizinha.nome])));
      expect([t.nome, vizinha.familia, errada.message]).toEqual([t.nome, vizinha.familia, INDISPONIVEL]);
      const mudou = await erroDe(atualizar(t.nome, id, "tipo_operacao_id=null, tipo_operacao_versao_id=null"));
      expect([t.nome, mudou.message]).toEqual([t.nome, IMUTAVEL]);
    }
  });
});

/**
 * As PÓS-CONDIÇÕES só leem OBJETOS (catálogo), nunca tabela viva — no deploy a tabela viva tem o dado de produção. E
 * cada uma morde: o bloco delas (o trecho "7)" do arquivo, como está) roda de novo sobre o banco aplicado, com UM objeto
 * quebrado numa transação desfeita, e recusa com a SUA mensagem.
 */
describe("U4/U5 — pós-condições e reaplicação", () => {
  it("U4 pós-condições: só de objetos, passam no banco aplicado, e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const inicio = SQL_ALVO.indexOf("-- ---------- 7) pós-condições nomeadas");
    expect(inicio, "o trecho 7) existe").toBeGreaterThan(0);
    const pos = SQL_ALVO.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const COLUNAS = `${M}colunas novas ausentes, de outro tipo, obrigatorias ou com default (esperadas 13: tipo_operacao_id e tipo_operacao_versao_id uuid nas seis tabelas e maintenances.note text, todas anulaveis).`;
    const COMENTARIO = `${M}coluna nova sem comentario (esperadas 13 comentadas).`;
    const CHECKS = `${M}CHECKs de par da TOP (chk_<modulo>_tipo_operacao_par) ausentes, nao validados ou diferentes de (tipo_operacao_id is null) = (tipo_operacao_versao_id is null) (esperados 6).`;
    const FKS = `${M}FKs compostas da TOP ausentes, em cascata ou fora da forma (tipo_operacao_id, organization_id) -> erp.tipos_operacao (id, organization_id) e (tipo_operacao_versao_id, tipo_operacao_id, organization_id) -> erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id) (esperadas 12).`;
    const FUNCAO = `${M}erp.modulo_top_conferir() ausente, SECURITY DEFINER, nao volatil, fora de plpgsql ou sem search_path "erp, pg_temp".`;
    const EXECUTE = `${M}EXECUTE de erp.modulo_top_conferir() concedido alem do dono.`;
    const GATILHOS = `${M}gatilhos trg_<modulo>_top_conferir ausentes, desligados, fora da forma (BEFORE INSERT OR UPDATE OF tipo_operacao_id, tipo_operacao_versao_id, FOR EACH ROW, sem WHEN) ou com a familia errada no argumento (esperados 6, e so eles na funcao).`;
    const POLITICA = `${M}politicas de erp.maintenance_items diferentes de api_child_select/_insert/_update/_delete (uma por comando, PERMISSIVE, para erp_app; ler pela maquina -> manutencao; gravar pela manutencao E pelo local nulo ou visivel).`;
    const RLS = `${M}RLS desligada ou nao forcada numa das sete tabelas (as seis dos modulos e erp.maintenance_items).`;
    const PAR_SQL = "(tipo_operacao_id is null) = (tipo_operacao_versao_id is null)";
    const refazerGatilho = (t: string, corpo: string) => `drop trigger trg_${t}_top_conferir on erp.${t}; create trigger trg_${t}_top_conferir ${corpo}`;
    /** Troca UMA das quatro políticas por outra do mesmo nome (`corpo` = o comando, os papéis e os predicados). */
    const refazerPolitica = (nome: string, corpo: string) => `drop policy ${nome} on erp.maintenance_items; create policy ${nome} on erp.maintenance_items ${corpo}`;
    const GRAVAR = `${POLITICA_NOVA} and ${GUARDA_DO_LOCAL}`;
    const casos: [string, string, string][] = [
      ["observação com outro tipo", "alter table erp.maintenances alter column note type varchar(2000)", COLUNAS],
      ["coluna da TOP com default", "alter table erp.feed_batches alter column tipo_operacao_id set default gen_random_uuid()", COLUNAS],
      ["coluna da TOP ausente", "alter table erp.animal_handlings drop column tipo_operacao_versao_id cascade", COLUNAS],
      ["coluna nova sem comentário", "comment on column erp.service_orders.tipo_operacao_versao_id is null", COMENTARIO],
      ["CHECK de par ausente", "alter table erp.animal_handlings drop constraint chk_animal_handlings_tipo_operacao_par", CHECKS],
      ["CHECK de par não validado", `alter table erp.diet_batches drop constraint chk_diet_batches_tipo_operacao_par, add constraint chk_diet_batches_tipo_operacao_par check (${PAR_SQL}) not valid`, CHECKS],
      ["CHECK de par com outra expressão", "alter table erp.fuel_supplies drop constraint chk_fuel_supplies_tipo_operacao_par, add constraint chk_fuel_supplies_tipo_operacao_par check ((tipo_operacao_id is null) or (tipo_operacao_versao_id is not null))", CHECKS],
      ["FK da TOP em cascata", "alter table erp.diet_batches drop constraint fk_diet_batches_tipo_operacao, add constraint fk_diet_batches_tipo_operacao foreign key (tipo_operacao_id, organization_id) references erp.tipos_operacao (id, organization_id) on delete cascade", FKS],
      ["FK da versão de coluna só", "alter table erp.maintenances drop constraint fk_maintenances_tipo_operacao_versao, add constraint fk_maintenances_tipo_operacao_versao foreign key (tipo_operacao_versao_id) references erp.tipos_operacao_versoes (id)", FKS],
      ["FK adiável", "alter table erp.service_orders drop constraint fk_service_orders_tipo_operacao, add constraint fk_service_orders_tipo_operacao foreign key (tipo_operacao_id, organization_id) references erp.tipos_operacao (id, organization_id) deferrable", FKS],
      ["FK da TOP ausente", "alter table erp.feed_batches drop constraint fk_feed_batches_tipo_operacao", FKS],
      ["função SECURITY DEFINER", "alter function erp.modulo_top_conferir() security definer", FUNCAO],
      ["função sem search_path", "alter function erp.modulo_top_conferir() reset search_path", FUNCAO],
      ["função estável", "alter function erp.modulo_top_conferir() stable", FUNCAO],
      ["EXECUTE do erp_app", "grant execute on function erp.modulo_top_conferir() to erp_app", EXECUTE],
      ["EXECUTE de PUBLIC", "grant execute on function erp.modulo_top_conferir() to public", EXECUTE],
      ["gatilho desligado", "alter table erp.feed_batches disable trigger trg_feed_batches_top_conferir", GATILHOS],
      ["gatilho ausente", "drop trigger trg_service_orders_top_conferir on erp.service_orders", GATILHOS],
      ["gatilho com a família de outra tabela", refazerGatilho("diet_batches",
        "before insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.diet_batches for each row execute function erp.modulo_top_conferir('pecuaria.manejo')"), GATILHOS],
      ["gatilho sem argumento", refazerGatilho("maintenances",
        "before insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.maintenances for each row execute function erp.modulo_top_conferir()"), GATILHOS],
      ["gatilho só no INSERT", refazerGatilho("fuel_supplies",
        "before insert on erp.fuel_supplies for each row execute function erp.modulo_top_conferir('frota_ativos.abastecimento')"), GATILHOS],
      ["gatilho de UPDATE de uma coluna só", refazerGatilho("animal_handlings",
        "before insert or update of tipo_operacao_id on erp.animal_handlings for each row execute function erp.modulo_top_conferir('pecuaria.manejo')"), GATILHOS],
      ["gatilho depois (AFTER)", refazerGatilho("service_orders",
        "after insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.service_orders for each row execute function erp.modulo_top_conferir('ordens_servico.ordem_de_servico')"), GATILHOS],
      ["gatilho com WHEN", refazerGatilho("feed_batches",
        "before insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.feed_batches for each row when (new.tipo_operacao_id is not null) execute function erp.modulo_top_conferir('estoque.producao_de_racao')"), GATILHOS],
      ["um gatilho a mais na função", "create trigger trg_f10_extra before insert on erp.fuel_supplies for each row execute function erp.modulo_top_conferir('frota_ativos.abastecimento')", GATILHOS],
      ["uma política a mais", "create policy f10_extra on erp.maintenance_items for select to erp_app using (true)", POLITICA],
      ["de volta à da 0007 (uma, for all, pelo local)", `drop policy api_child_select on erp.maintenance_items; drop policy api_child_insert on erp.maintenance_items; drop policy api_child_update on erp.maintenance_items; drop policy api_child_delete on erp.maintenance_items; create policy api_child on erp.maintenance_items for all to erp_app using (${POLITICA_0007}) with check (${POLITICA_0007})`, POLITICA],
      ["uma das quatro some", "drop policy api_child_delete on erp.maintenance_items", POLITICA],
      ["leitura também pelo local", refazerPolitica("api_child_select", `for select to erp_app using (${GRAVAR})`), POLITICA],
      ["leitura para authenticated também", refazerPolitica("api_child_select", `for select to erp_app, authenticated using (${POLITICA_NOVA})`), POLITICA],
      ["gravação sem a guarda do local", refazerPolitica("api_child_insert", `for insert to erp_app with check (${POLITICA_NOVA})`), POLITICA],
      ["gravação sem a manutenção", refazerPolitica("api_child_insert", `for insert to erp_app with check (${GUARDA_DO_LOCAL})`), POLITICA],
      ["alteração com outro with check", refazerPolitica("api_child_update", `for update to erp_app using (${POLITICA_NOVA}) with check (true)`), POLITICA],
      ["alteração com outro using", refazerPolitica("api_child_update", `for update to erp_app using (true) with check (${GRAVAR})`), POLITICA],
      ["apagar como RESTRICTIVE", refazerPolitica("api_child_delete", `as restrictive for delete to erp_app using (${POLITICA_NOVA})`), POLITICA],
      ["apagar no comando errado", refazerPolitica("api_child_delete", `for all to erp_app using (${POLITICA_NOVA}) with check (${GRAVAR})`), POLITICA],
      ["RLS dos itens não forçada", "alter table erp.maintenance_items no force row level security", RLS],
      ["RLS de um módulo desligada", "alter table erp.diet_batches disable row level security", RLS]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => t.query(sabotagem))]).toEqual([nome, mensagem]);
    }
    // Nada ficou: os seis gatilhos, a função sem EXECUTE e as quatro políticas novas, como a migration os deixou.
    expect(await gatilhosDaTop()).toEqual(NOMES.map((t) => `trg_${t}_top_conferir`).sort());
    expect((await db.query<{ x: boolean }>("select has_function_privilege('erp_app', 'erp.modulo_top_conferir()', 'execute') x")).rows[0]!.x).toBe(false);
    expect((await politicaDosItens()).map((p) => p.policyname)).toEqual(POLITICAS_NOVAS);
  });

  it("U5 reaplicar é recusado pela pré-condição 'já aplicada', sem efeito", async () => {
    expect(await recusaDaAlvo()).toBe(JA);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n).toBe(1);
  });
});
